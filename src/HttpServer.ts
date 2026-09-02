/**
 * HttpServer — minimal HTTP/1.1 server that bypasses node:http overhead.
 *
 * When to use: JSON API servers where profiling shows node:http overhead
 * (IncomingMessage allocation, EventEmitter, writeHead serialization) as
 * the bottleneck. For HTTP/2, chunked encoding, or full compliance, use
 * node:http or a framework.
 *
 * Internal design:
 *   kServer: net.Server — underlying TCP server
 *   kHandler: Handler — user's request dispatch function
 *   Per-connection: reusable Request + accumulation Buffer (no per-request alloc)
 *   Request.[kHdrBuf/kHdrStart/kHdrEnd]: raw header region for lazy getHeader()
 *
 * Design tradeoffs:
 * - Hand-rolled parser eliminates per-request allocation (no IncomingMessage,
 *   no headers object, no EventEmitter). Only URL and body are allocated.
 * - Headers parsed lazily via getHeader() — no string created unless read.
 * - Response uses pre-computed prefix + string concat for single socket.write().
 * - Supports HTTP/1.1 keep-alive and pipelining; no chunked TE, no upgrades.
 *
 * Prior art: uWebSockets.js (C++), Deno.serve (Rust). This module achieves
 * comparable throughput in pure JS on Node.js net.createServer.
 *
 * @example
 * ```ts
 * import * as HttpServer from "@dolphin278/vjuga/HttpServer";
 * const server = HttpServer.make((req, socket) => {
 *   if (req.method === HttpServer.GET && req.url === "/health")
 *     HttpServer.respond(socket, 200, '{"ok":true}');
 * });
 * await HttpServer.listen(server, 3000);
 * ```
 */

import * as net from "node:net";

// ── HTTP method constants ───────────────────────────────────────────
export const GET = 1;
export const POST = 2;
export const PUT = 3;
export const DELETE = 4;

// ── Private symbols ─────────────────────────────────────────────────
const kServer: unique symbol = Symbol("server");
const kHandler: unique symbol = Symbol("handler");

const kHdrBuf: unique symbol = Symbol("hdrBuf");
const kHdrStart: unique symbol = Symbol("hdrStart");
const kHdrEnd: unique symbol = Symbol("hdrEnd");

// ── Public types ────────────────────────────────────────────────────

export interface HttpServer {
  [kServer]: net.Server;
  [kHandler]: Handler;
}

/**
 * Parsed HTTP request. Reused per connection — do NOT retain references
 * across handler calls.
 */
export interface Request {
  method: number;
  url: string;
  pathEnd: number;
  qIdx: number;
  body: string | null;
  // Internal: raw header region for lazy getHeader()
  [kHdrBuf]: Buffer;
  [kHdrStart]: number;
  [kHdrEnd]: number;
}

export type Handler = (req: Request, socket: net.Socket) => void;

// ── Internal types ──────────────────────────────────────────────────

interface ConnState {
  buf: Buffer;
  used: number;
  req: Request;
}

// ── Constants ───────────────────────────────────────────────────────

const EMPTY_BUF = Buffer.alloc(0);
const CRLFCRLF = Buffer.from("\r\n\r\n");
const CL_TITLE = Buffer.from("\r\nContent-Length: ");
const CL_LOWER = Buffer.from("\r\ncontent-length: ");
const INITIAL_BUF_SIZE = 8192;
const MAX_HEADER_SIZE = 65536; // 64KB max headers

const JSON_CT = "application/json";

// Pre-computed response status lines + JSON Content-Type header + keep-alive
// Format: "HTTP/1.1 {status} {text}\r\nContent-Type: application/json\r\nConnection: keep-alive\r\nContent-Length: "
const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  500: "Internal Server Error",
};

// Cache of status→prefix strings, lazily populated
const jsonPrefixCache = new Map<number, string>();

function jsonPrefix(status: number): string {
  let p = jsonPrefixCache.get(status);
  /* node:coverage ignore next 2 */
  if (p !== undefined) return p;
  const text = STATUS_TEXT[status] ?? "Unknown";
  p = `HTTP/1.1 ${status} ${text}\r\nContent-Type: ${JSON_CT}\r\nConnection: keep-alive\r\nContent-Length: `;
  jsonPrefixCache.set(status, p);
  return p;
}

// Pre-warm common statuses so hot-path lookups are cache hits
jsonPrefix(200);
jsonPrefix(201);
jsonPrefix(400);
jsonPrefix(401);
jsonPrefix(404);
jsonPrefix(500);

// ── Factory ─────────────────────────────────────────────────────────

/* node:coverage ignore next */
function noop(): void {}

function makeRequest(): Request {
  const req: Request = {
    method: 0,
    url: "",
    pathEnd: 0,
    qIdx: -1,
    body: null,
    [kHdrBuf]: EMPTY_BUF,
    [kHdrStart]: 0,
    [kHdrEnd]: 0,
  };
  // Double-write every mutable field — prevents JIT constant-folding
  // which would trigger a deopt cascade on first mutation by the parser
  req.method = 0;
  req.url = "";
  req.pathEnd = 0;
  req.qIdx = -1;
  req.body = null;
  req[kHdrBuf] = EMPTY_BUF;
  req[kHdrStart] = 0;
  req[kHdrEnd] = 0;
  return req;
}

function makeConnState(): ConnState {
  const conn: ConnState = {
    buf: Buffer.allocUnsafe(INITIAL_BUF_SIZE),
    used: 0,
    req: makeRequest(),
  };
  // Double-write mutable numeric field
  conn.used = 0;
  return conn;
}

/**
 * Create an HttpServer with the given request handler.
 * The handler is called synchronously for each parsed request.
 */
export function make(handler: Handler): HttpServer {
  const tcpServer = net.createServer((socket) => {
    // Disable Nagle's algorithm — small HTTP responses (e.g. {"ok":true})
    // must not be delayed waiting for more data to fill a TCP segment
    socket.setNoDelay(true);

    const conn = makeConnState();

    // Closure is intentional. We benchmarked both a module-level onData with
    // WeakMap lookup and onData.bind(socket, conn, handler). Both were slower:
    // bind() adds a CallBoundFunction trampoline (24 ticks) and doubles
    // emit() cost (25→53 ticks); WeakMap adds hash lookup overhead (15 ticks).
    // V8 optimizes closure variable access as a direct context-slot read,
    // which beats both alternatives by 3–6% throughput.
    socket.on("data", (chunk: Buffer) => {
      // Ensure buffer capacity
      const needed = conn.used + chunk.length;
      if (needed > conn.buf.length) {
        const newSize = Math.max(conn.buf.length * 2, needed);
        const newBuf = Buffer.allocUnsafe(newSize);
        /* node:coverage ignore next 2 */
        if (conn.used > 0) conn.buf.copy(newBuf, 0, 0, conn.used);
        conn.buf = newBuf;
      }

      // Append chunk
      chunk.copy(conn.buf, conn.used);
      conn.used += chunk.length;

      // Process all complete requests (pipelining support)
      processBuffer(conn, socket, handler);
    });

    socket.on("error", noop);
  });

  const server: HttpServer = {
    [kServer]: tcpServer,
    [kHandler]: handler,
  };

  return server;
}

// ── Lifecycle ───────────────────────────────────────────────────────

/** Start listening on the given port. Resolves when the server is ready. */
export function listen(server: HttpServer, port: number, host?: string): Promise<void> {
  return new Promise<void>((resolve) => {
    server[kServer].listen(port, host ?? "127.0.0.1", () => resolve());
  });
}

/** Close the server. Resolves when all connections are terminated. */
export function close(server: HttpServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server[kServer].close((err) => {
      /* node:coverage ignore next 2 */
      if (err) reject(err);
      else resolve();
    });
  });
}

// ── Response helpers ────────────────────────────────────────────────

/**
 * Write a JSON response. `body` should be a pre-serialized JSON string.
 * Uses a single socket.write() call — prefix is pre-computed, body is
 * concatenated inline. Avoids the writeHead/end overhead of node:http.
 */
export function respond(
  socket: net.Socket,
  status: number,
  body: string,
  contentType?: string,
): void {
  if (contentType === undefined || contentType === JSON_CT) {
    // Fast path: JSON content type, pre-cached prefix
    const prefix = jsonPrefixCache.get(status) ?? jsonPrefix(status);
    socket.write(prefix + Buffer.byteLength(body) + "\r\n\r\n" + body);
  } else {
    // Slow path: custom content type
    const text = STATUS_TEXT[status] ?? "Unknown";
    socket.write(
      `HTTP/1.1 ${status} ${text}\r\nContent-Type: ${contentType}\r\nConnection: keep-alive\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    );
  }
}

/**
 * Write a pre-computed response Buffer. Zero per-request allocation.
 * Use with precompute() for static or cached responses.
 */
export function respondRaw(socket: net.Socket, response: Buffer): void {
  socket.write(response);
}

/**
 * Write a Buffer body with custom content type. Uses cork/uncork to
 * batch header string and body buffer into one TCP segment.
 */
export function respondBuffer(
  socket: net.Socket,
  status: number,
  body: Buffer,
  contentType: string,
): void {
  const text = STATUS_TEXT[status] ?? "Unknown";
  socket.cork();
  socket.write(
    `HTTP/1.1 ${status} ${text}\r\nContent-Type: ${contentType}\r\nConnection: keep-alive\r\nContent-Length: ${body.length}\r\n\r\n`,
  );
  socket.write(body);
  socket.uncork();
}

/**
 * Pre-compute a complete HTTP response as a single Buffer.
 * Call once at startup, then use respondRaw() per request.
 */
export function precompute(status: number, body: string, contentType?: string): Buffer {
  const ct = contentType ?? JSON_CT;
  const text = STATUS_TEXT[status] ?? "Unknown";
  const bodyLen = Buffer.byteLength(body);
  const header = `HTTP/1.1 ${status} ${text}\r\nContent-Type: ${ct}\r\nConnection: keep-alive\r\nContent-Length: ${bodyLen}\r\n\r\n`;
  return Buffer.from(header + body);
}

// ── Request helpers ─────────────────────────────────────────────────

/**
 * Look up a header value by name (case-insensitive).
 * Scans the raw header buffer lazily — no allocation unless the header is found.
 */
export function getHeader(req: Request, name: string): string | null {
  const buf = req[kHdrBuf];
  const start = req[kHdrStart];
  const end = req[kHdrEnd];
  if (start >= end) return null;

  const nameLower = name.toLowerCase();
  const nameLen = nameLower.length;

  let pos = start;
  while (pos < end) {
    // Find end of current header line (\r)
    const cr = buf.indexOf(0x0d, pos);
    if (cr === -1 || cr >= end) break;

    // Check if this line starts with the target header name (case-insensitive)
    const lineLen = cr - pos;
    // Minimum valid header: "N: V" → nameLen + 2
    if (lineLen >= nameLen + 2) {
      let match = true;
      for (let i = 0; i < nameLen; i++) {
        let c = buf[pos + i];
        // ASCII toLowerCase: if uppercase (65–90), add 32
        if (c >= 65 && c <= 90) c += 32;
        if (c !== nameLower.charCodeAt(i)) {
          match = false;
          break;
        }
      }
      if (match && buf[pos + nameLen] === 58 /* ':' */) {
        // Skip colon and optional whitespace (OWS per RFC 7230 §3.2.3)
        let valStart = pos + nameLen + 1;
        while (valStart < cr && buf[valStart] === 32) valStart++;
        return buf.toString("utf8", valStart, cr);
      }
    }

    // Skip past \r\n to the next line
    pos = cr + 2;
  }
  return null;
}

// ── Internal: request parsing ───────────────────────────────────────

/**
 * Process all complete requests in the connection buffer.
 * Supports HTTP pipelining — multiple requests may arrive in one chunk.
 */
function processBuffer(conn: ConnState, socket: net.Socket, handler: Handler): void {
  let offset = 0;

  while (offset < conn.used) {
    const consumed = tryParse(conn.buf, offset, conn.used, conn.req);
    if (consumed === -1) break; // incomplete request — wait for more data
    // Guard against oversized headers (tryParse returns -2)
    /* node:coverage disable */
    if (consumed === -2) {
      socket.destroy();
      return;
    }
    /* node:coverage enable */
    handler(conn.req, socket);
    offset = consumed;
  }

  // Compact: move unconsumed data to start of buffer
  if (offset > 0) {
    const remaining = conn.used - offset;
    if (remaining > 0) conn.buf.copy(conn.buf, 0, offset, conn.used);
    conn.used = remaining;
  }
}

/**
 * Try to parse one HTTP request starting at `offset`.
 * Returns the offset past the request (for pipelining), or -1 if incomplete.
 *
 * Parser avoids object allocation: method is a numeric enum, URL is a single
 * substring, headers are stored as a buffer reference for lazy access.
 */
function tryParse(buf: Buffer, offset: number, end: number, req: Request): number {
  // Guard: need at least "GET / HTTP/1.1\r\n\r\n" = 18 bytes
  if (end - offset < 18) return -1;

  // Find end of headers (\r\n\r\n)
  const headerEnd = buf.indexOf(CRLFCRLF, offset);
  if (headerEnd === -1 || headerEnd >= end) {
    // Guard against oversized headers
    /* node:coverage ignore next 2 */
    if (end - offset > MAX_HEADER_SIZE) return -2;
    return -1;
  }

  // ── Parse request line ────────────────────────────────────────

  // Method: check first byte (avoids string comparison)
  //   G(0x47)=GET, P(0x50)=POST/PUT, D(0x44)=DELETE
  const b0 = buf[offset];
  if (b0 === 0x47) {
    req.method = GET;
  } else if (b0 === 0x50) {
    // P: distinguish POST (PO) from PUT (PU)
    req.method = buf[offset + 1] === 0x4f ? POST : PUT;
  } else if (b0 === 0x44) {
    req.method = DELETE;
  } else {
    req.method = 0;
  }

  // URL: between first and second space on request line
  let pos = offset;
  while (pos < headerEnd && buf[pos] !== 0x20) pos++; // skip method
  const urlStart = pos + 1;
  pos = urlStart;
  while (pos < headerEnd && buf[pos] !== 0x20) pos++; // skip URL
  const urlEnd = pos;

  req.url = buf.toString("utf8", urlStart, urlEnd);

  // Query string: find '?' in URL
  const qPos = req.url.indexOf("?");
  req.qIdx = qPos;
  req.pathEnd = qPos >= 0 ? qPos : req.url.length;

  // ── Store header region for lazy getHeader() ──────────────────

  // Headers start after the first \r\n (end of request line)
  const firstLF = buf.indexOf(0x0a, offset);
  req[kHdrBuf] = buf;
  req[kHdrStart] = firstLF + 1;
  req[kHdrEnd] = headerEnd;

  // ── Body parsing (POST/PUT only) ──────────────────────────────

  const bodyStart = headerEnd + 4; // past \r\n\r\n

  if (req.method === POST || req.method === PUT) {
    const cl = findContentLength(buf, firstLF, headerEnd);
    if (cl > 0) {
      const bodyEnd = bodyStart + cl;
      if (bodyEnd > end) return -1; // incomplete body — wait for more data
      req.body = buf.toString("utf8", bodyStart, bodyEnd);
      return bodyEnd;
    }
  }

  req.body = null;
  return bodyStart;
}

/**
 * Search for Content-Length header in the raw header bytes.
 * Checks both "Content-Length:" (common) and "content-length:" (curl).
 * Returns 0 if not found.
 */
function findContentLength(buf: Buffer, start: number, end: number): number {
  // Try title case first (most clients), then lowercase
  let idx = buf.indexOf(CL_TITLE, start);
  if (idx === -1 || idx >= end) {
    idx = buf.indexOf(CL_LOWER, start);
    if (idx === -1 || idx >= end) return 0;
    idx += CL_LOWER.length;
  } else {
    idx += CL_TITLE.length;
  }

  // Parse decimal digits
  let len = 0;
  while (idx < end) {
    const c = buf[idx];
    /* node:coverage ignore next 2 */
    if (c < 48 || c > 57) break; // not a digit
    len = len * 10 + (c - 48);
    idx++;
  }
  return len;
}
