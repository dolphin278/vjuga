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
 *   kConns: Map<Socket, ConnState> — live connections (for close())
 *   Per-connection: reusable Request + accumulation Buffer (no per-request alloc)
 *   Request.[kHdrBuf/kHdrStart/kHdrEnd]: raw header region for lazy getHeader()
 *
 * Design tradeoffs:
 * - Hand-rolled parser eliminates per-request allocation (no IncomingMessage,
 *   no headers object, no EventEmitter). Only URL and body are allocated.
 * - Framing is strict to prevent request smuggling: Content-Length is honored
 *   for every method; malformed framing → 400, Transfer-Encoding → 501,
 *   oversized headers/body → 431/413, each followed by connection close.
 * - Response uses pre-computed prefix + string concat for single socket.write().
 * - Keep-alive and pipelining with backpressure: dispatch pauses while the
 *   socket's write buffer is full. No chunked TE, no upgrades.
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
// Any other method token (HEAD, OPTIONS, …) is reported as method 0.
export const GET = 1;
export const POST = 2;
export const PUT = 3;
export const DELETE = 4;
export const PATCH = 5;

// ── Private symbols ─────────────────────────────────────────────────
const kServer: unique symbol = Symbol("server");
const kHandler: unique symbol = Symbol("handler");
const kConns: unique symbol = Symbol("conns");
const kConfig: unique symbol = Symbol("config");

const kHdrBuf: unique symbol = Symbol("hdrBuf");
const kHdrStart: unique symbol = Symbol("hdrStart");
const kHdrEnd: unique symbol = Symbol("hdrEnd");

// ── Public types ────────────────────────────────────────────────────

export interface HttpServer {
  [kServer]: net.Server;
  [kHandler]: Handler;
  [kConns]: Map<net.Socket, ConnState>;
  [kConfig]: Config;
}

/**
 * Parsed HTTP request. Reused per connection — do NOT retain references
 * across handler calls.
 */
export interface Request {
  /** GET/POST/PUT/DELETE/PATCH constant, or 0 for any other method. */
  method: number;
  url: string;
  pathEnd: number;
  qIdx: number;
  /** Body decoded as UTF-8 when Content-Length > 0, otherwise null. */
  body: string | null;
  // Internal: raw header region for lazy getHeader()
  [kHdrBuf]: Buffer;
  [kHdrStart]: number;
  [kHdrEnd]: number;
}

export type Handler = (req: Request, socket: net.Socket) => void;

/** Server limits and timeouts. All sizes in bytes, all times in ms. */
export interface Options {
  /** Max request-line + header block size; larger → 431 + close. Default 65536. */
  maxHeaderSize?: number;
  /** Max Content-Length; larger → 413 + close. Default 1 MiB. */
  maxBodySize?: number;
  /**
   * Max time from the first byte of a request until its header block is
   * complete (slowloris guard), checked whenever data arrives; 0 disables.
   * Default 60000.
   */
  headersTimeout?: number;
  /**
   * Socket inactivity timeout (no bytes read or written) after which the
   * connection is destroyed; 0 disables. Default 5000. NOTE: this also
   * applies while a handler is preparing an asynchronous response — raise it
   * if handlers can stay silent longer than this.
   */
  keepAliveTimeout?: number;
  /**
   * Called when the connection is destroyed because of an exception thrown
   * by the handler (or an internal parser fault). Default: ignore.
   */
  onError?: (err: unknown, socket: net.Socket) => void;
}

// ── Internal types ──────────────────────────────────────────────────

interface Config {
  maxHeaderSize: number;
  maxBodySize: number;
  headersTimeout: number;
  onError: (err: unknown, socket: net.Socket) => void;
  closing: boolean;
}

interface ConnState {
  buf: Buffer;
  used: number;
  /** Bytes needed at buf[0..] before re-parsing (pending body); 0 = unknown. */
  need: number;
  /** Resume position for the header-terminator search. */
  scan: number;
  /** Date.now() when the pending partial header block started; 0 = none. */
  hdrSince: number;
  /** Dispatch suspended until the socket drains. */
  paused: boolean;
  /** Connection rejected/destroyed — ignore further input. */
  dead: boolean;
  req: Request;
}

// ── Constants ───────────────────────────────────────────────────────

const EMPTY_BUF = Buffer.alloc(0);
const CRLFCRLF = Buffer.from("\r\n\r\n");
const INITIAL_BUF_SIZE = 8192;
// A connection buffer grown past this is replaced once the connection is idle
const MAX_IDLE_BUF_SIZE = 131072;
const DEFAULT_MAX_HEADER_SIZE = 65536;
const DEFAULT_MAX_BODY_SIZE = 1048576;
const DEFAULT_HEADERS_TIMEOUT = 60000;
const DEFAULT_KEEP_ALIVE_TIMEOUT = 5000;

// Header names checked by the framing parser (exact bytes, both cases)
const CL_LO = Buffer.from("content-length");
const CL_UP = Buffer.from("CONTENT-LENGTH");
const TE_LO = Buffer.from("transfer-encoding");
const TE_UP = Buffer.from("TRANSFER-ENCODING");

// tryParse() results < -1 are rejection codes
const INCOMPLETE = -1;
const E400 = -2;
const E413 = -3;
const E431 = -4;
const E501 = -5;

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
  413: "Content Too Large",
  431: "Request Header Fields Too Large",
  500: "Internal Server Error",
  501: "Not Implemented",
};

function closeResponse(status: number): Buffer {
  return Buffer.from(
    `HTTP/1.1 ${status} ${STATUS_TEXT[status]}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
  );
}

// Indexed by -code (E400 → 2, …)
const REJECT_RESPONSES: Buffer[] = [
  EMPTY_BUF,
  EMPTY_BUF,
  closeResponse(400),
  closeResponse(413),
  closeResponse(431),
  closeResponse(501),
];

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

function destroyOnTimeout(this: net.Socket): void {
  this.destroy();
}

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
    need: 0,
    scan: 0,
    hdrSince: 0,
    paused: false,
    dead: false,
    req: makeRequest(),
  };
  // Double-write mutable fields (see makeRequest)
  conn.used = 0;
  conn.need = 0;
  conn.scan = 0;
  conn.hdrSince = 0;
  conn.paused = false;
  conn.dead = false;
  return conn;
}

/**
 * Create an HttpServer with the given request handler.
 * The handler is called synchronously for each parsed request; an exception
 * it throws destroys that connection (reported via `options.onError`).
 * See {@link Options} for limits and timeouts.
 */
export function make(handler: Handler, options?: Options): HttpServer {
  const cfg: Config = {
    maxHeaderSize: options?.maxHeaderSize ?? DEFAULT_MAX_HEADER_SIZE,
    maxBodySize: options?.maxBodySize ?? DEFAULT_MAX_BODY_SIZE,
    headersTimeout: options?.headersTimeout ?? DEFAULT_HEADERS_TIMEOUT,
    onError: options?.onError ?? noop,
    closing: false,
  };
  const keepAliveTimeout = options?.keepAliveTimeout ?? DEFAULT_KEEP_ALIVE_TIMEOUT;
  const conns = new Map<net.Socket, ConnState>();

  const tcpServer = net.createServer((socket) => {
    // Disable Nagle's algorithm — small HTTP responses (e.g. {"ok":true})
    // must not be delayed waiting for more data to fill a TCP segment
    socket.setNoDelay(true);
    // Set once per connection: re-arming per request would allocate a timer
    if (keepAliveTimeout > 0) {
      socket.setTimeout(keepAliveTimeout);
      socket.on("timeout", destroyOnTimeout);
    }

    const conn = makeConnState();
    conns.set(socket, conn);

    // Closure is intentional. We benchmarked both a module-level onData with
    // WeakMap lookup and onData.bind(socket, conn, handler). Both were slower:
    // bind() adds a CallBoundFunction trampoline (24 ticks) and doubles
    // emit() cost (25→53 ticks); WeakMap adds hash lookup overhead (15 ticks).
    // V8 optimizes closure variable access as a direct context-slot read,
    // which beats both alternatives by 3–6% throughput.
    socket.on("data", (chunk: Buffer) => {
      // No exception may escape a 'data' listener: it would be uncaught and
      // take down the whole process. Kill only the offending connection.
      try {
        onData(conn, socket, chunk, handler, cfg);
      } catch (err) {
        fail(conn, socket, err, cfg);
      }
    });

    socket.on("close", () => conns.delete(socket));
    socket.on("error", noop);
  });

  const server: HttpServer = {
    [kServer]: tcpServer,
    [kHandler]: handler,
    [kConns]: conns,
    [kConfig]: cfg,
  };

  return server;
}

function onData(
  conn: ConnState,
  socket: net.Socket,
  chunk: Buffer,
  handler: Handler,
  cfg: Config,
): void {
  if (conn.dead) return;

  // Ensure buffer capacity
  const needed = conn.used + chunk.length;
  if (needed > conn.buf.length) {
    const newBuf = Buffer.allocUnsafe(Math.max(conn.buf.length * 2, needed));
    conn.buf.copy(newBuf, 0, 0, conn.used);
    conn.buf = newBuf;
  }

  // Append chunk
  chunk.copy(conn.buf, conn.used);
  conn.used = needed;

  // Waiting for drain, or for the rest of an already-framed body
  if (conn.paused || needed < conn.need) return;

  if (conn.hdrSince !== 0 && Date.now() - conn.hdrSince > cfg.headersTimeout) {
    conn.dead = true;
    socket.destroy();
    return;
  }

  // Process all complete requests (pipelining support)
  processBuffer(conn, socket, handler, cfg);
}

function fail(conn: ConnState, socket: net.Socket, err: unknown, cfg: Config): void {
  conn.dead = true;
  socket.destroy();
  cfg.onError(err, socket);
}

function resume(conn: ConnState, socket: net.Socket, handler: Handler, cfg: Config): void {
  conn.paused = false;
  socket.resume();
  try {
    processBuffer(conn, socket, handler, cfg);
  } catch (err) {
    fail(conn, socket, err, cfg);
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────

/** Start listening on the given port. Resolves when the server is ready. */
export function listen(server: HttpServer, port: number, host?: string): Promise<void> {
  return new Promise<void>((resolve) => {
    server[kServer].listen(port, host ?? "127.0.0.1", () => resolve());
  });
}

/**
 * Close the server. Stops accepting connections, destroys idle ones (no
 * partially received request, nothing left to write) immediately and the
 * rest as soon as they become idle (or hit a timeout). Resolves when all
 * connections are terminated. A connection whose handler is still preparing
 * an asynchronous response looks idle and is destroyed — finish in-flight
 * work before calling close().
 */
export function close(server: HttpServer): Promise<void> {
  server[kConfig].closing = true;
  const done = new Promise<void>((resolve, reject) => {
    server[kServer].close((err) => {
      /* node:coverage ignore next 2 */
      if (err) reject(err);
      else resolve();
    });
  });
  for (const [socket, conn] of server[kConns]) {
    if (conn.used !== 0) continue; // mid-request: closed once it completes
    conn.dead = true;
    if (socket.writableLength === 0) socket.destroy();
    else socket.end(); // flush pending responses first
  }
  return done;
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
    // Find end of current header line (\r). `end` is the CR of the final
    // CRLFCRLF, i.e. the last header line's own CR, so cr <= end always.
    const cr = buf.indexOf(0x0d, pos);

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
        // Skip colon and trim OWS (SP / HTAB, RFC 9110 §5.5) on both sides
        let valStart = pos + nameLen + 1;
        while (valStart < cr && (buf[valStart] === 0x20 || buf[valStart] === 0x09)) valStart++;
        let valEnd = cr;
        while (valEnd > valStart && (buf[valEnd - 1] === 0x20 || buf[valEnd - 1] === 0x09))
          valEnd--;
        return buf.toString("utf8", valStart, valEnd);
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
function processBuffer(conn: ConnState, socket: net.Socket, handler: Handler, cfg: Config): void {
  const used = conn.used;
  let offset = 0;
  let scan = conn.scan;
  let consumed = 0;

  while (offset < used) {
    consumed = tryParse(conn, offset, used, scan, cfg);
    // Progress invariant: a parse must advance and stay inside the valid
    // region, otherwise compaction would corrupt `used` (G6-1).
    if (consumed <= offset || consumed > used) {
      if (consumed === INCOMPLETE) break; // wait for more data
      reject(conn, socket, consumed);
      return;
    }
    scan = 0;
    offset = consumed;
    handler(conn.req, socket);
    // Backpressure: stop dispatching while the peer is not reading
    if (socket.writableNeedDrain) {
      conn.paused = true;
      socket.pause();
      socket.once("drain", () => resume(conn, socket, handler, cfg));
      break;
    }
  }

  if (consumed !== INCOMPLETE) {
    conn.need = 0;
    conn.scan = 0;
  }

  // Compact: move unconsumed data to start of buffer
  const remaining = used - offset;
  if (offset > 0) {
    if (remaining > 0) conn.buf.copy(conn.buf, 0, offset, used);
    conn.used = remaining;
  }

  if (remaining === 0) {
    conn.hdrSince = 0;
    if (conn.buf.length > MAX_IDLE_BUF_SIZE) conn.buf = Buffer.allocUnsafe(INITIAL_BUF_SIZE);
    if (cfg.closing && !conn.paused) {
      conn.dead = true;
      socket.end();
    }
  } else if (consumed === INCOMPLETE && conn.need === 0 && cfg.headersTimeout > 0) {
    // Partial header block pending: start (or restart, for a new request)
    // the headers deadline
    if (offset > 0 || conn.hdrSince === 0) conn.hdrSince = Date.now();
  } else {
    conn.hdrSince = 0;
  }
}

/** Send a canned error response and close the connection. */
function reject(conn: ConnState, socket: net.Socket, code: number): void {
  conn.dead = true;
  conn.used = 0;
  // A parser invariant violation (code >= 0) maps to no response at all
  socket.end(REJECT_RESPONSES[-code]);
}

/** True when buf[pos..pos+lo.length) equals the header name (ASCII, either case). */
function matchName(buf: Buffer, pos: number, lo: Buffer, up: Buffer): boolean {
  for (let i = 0; i < lo.length; i++) {
    const c = buf[pos + i];
    if (c !== lo[i] && c !== up[i]) return false;
  }
  return true;
}

/** Decode the method token buf[s..s+len) into a method constant (0 = other). */
function parseMethod(buf: Buffer, s: number, len: number): number {
  const b0 = buf[s];
  switch (len) {
    case 3:
      if (buf[s + 1] === 0x45 && buf[s + 2] === 0x54 && b0 === 0x47) return GET; // GET
      if (buf[s + 1] === 0x55 && buf[s + 2] === 0x54 && b0 === 0x50) return PUT; // PUT
      return 0;
    case 4: // POST
      return b0 === 0x50 && buf[s + 1] === 0x4f && buf[s + 2] === 0x53 && buf[s + 3] === 0x54
        ? POST
        : 0;
    case 5: // PATCH
      return b0 === 0x50 &&
        buf[s + 1] === 0x41 &&
        buf[s + 2] === 0x54 &&
        buf[s + 3] === 0x43 &&
        buf[s + 4] === 0x48
        ? PATCH
        : 0;
    case 6: // DELETE
      return b0 === 0x44 &&
        buf[s + 1] === 0x45 &&
        buf[s + 2] === 0x4c &&
        buf[s + 3] === 0x45 &&
        buf[s + 4] === 0x54 &&
        buf[s + 5] === 0x45
        ? DELETE
        : 0;
    default:
      return 0;
  }
}

/**
 * Parse a Content-Length value: `:` OWS 1*DIGIT OWS, from the colon at `i`
 * to the line's CR at `lineEnd`. Returns the value, -1 when malformed, or
 * MAX_SAFE_INTEGER when it has more than 15 digits.
 */
function parseContentLength(buf: Buffer, i: number, lineEnd: number): number {
  i++; // skip ':'
  while (i < lineEnd && (buf[i] === 0x20 || buf[i] === 0x09)) i++;
  const digitsStart = i;
  let len = 0;
  while (i < lineEnd) {
    const c = buf[i];
    if (c < 0x30 || c > 0x39) break;
    len = len * 10 + (c - 0x30);
    i++;
  }
  const digits = i - digitsStart;
  while (i < lineEnd && (buf[i] === 0x20 || buf[i] === 0x09)) i++;
  if (digits === 0 || i !== lineEnd) return -1;
  return digits > 15 ? Number.MAX_SAFE_INTEGER : len;
}

/**
 * Try to parse one HTTP request starting at `offset`.
 * Returns the offset past the request (for pipelining), INCOMPLETE, or a
 * rejection code (E400/E413/E431/E501). On INCOMPLETE, conn.need/conn.scan
 * are set relative to `offset` (which compaction moves to 0).
 *
 * Parser avoids object allocation: method is a numeric enum, URL is a single
 * substring, headers are stored as a buffer reference for lazy access.
 */
function tryParse(conn: ConnState, offset: number, end: number, scan: number, cfg: Config): number {
  const buf = conn.buf;
  const req = conn.req;

  // RFC 9112 §2.2: ignore empty lines before the request line
  let start = offset;
  while (start < end && (buf[start] === 0x0d || buf[start] === 0x0a)) start++;

  // Find end of headers (\r\n\r\n). Buffer is reused: bytes past `end` are
  // stale, so a match is only valid when the whole terminator lies inside
  // [start, end). Resume where the previous incomplete search stopped.
  const headerEnd = buf.indexOf(CRLFCRLF, scan > start ? scan : start);
  if (headerEnd === -1 || headerEnd + 4 > end) {
    // Counted from `offset` so a stream of empty lines cannot grow the buffer
    if (end - offset > cfg.maxHeaderSize) return E431;
    conn.need = 0;
    conn.scan = (end - 3 > start ? end - 3 : start) - offset;
    return INCOMPLETE;
  }
  const bodyStart = headerEnd + 4; // past \r\n\r\n
  if (bodyStart - offset > cfg.maxHeaderSize) return E431;

  // Byte scans below are plain JS loops: each Buffer#indexOf(byte) is a
  // native call costing more than scanning a short line inline. Every scan
  // for LF terminates by headerEnd + 1, which holds the terminator's LF.

  // ── Request line: METHOD SP URL SP VERSION CRLF ───────────────
  let sp1 = start;
  let b = buf[sp1];
  while (b !== 0x20 && b !== 0x0a) b = buf[++sp1];
  if (b === 0x0a || sp1 === start) return E400; // no method / no space
  let sp2 = sp1 + 1;
  b = buf[sp2];
  while (b !== 0x20 && b !== 0x0a) b = buf[++sp2];
  let firstLF = sp2;
  while (buf[firstLF] !== 0x0a) firstLF++;
  // Non-empty URL and version, line ends in CRLF
  if (sp2 === sp1 + 1 || sp2 + 2 >= firstLF || buf[firstLF - 1] !== 0x0d) {
    return E400;
  }
  const urlStart = sp1 + 1;

  // ── Framing headers: Content-Length / Transfer-Encoding ───────
  let cl = -1;
  let pos = firstLF + 1;
  const linesEnd = headerEnd + 2;
  while (pos < linesEnd) {
    let lf = pos;
    while (buf[lf] !== 0x0a) lf++;
    if (buf[lf - 1] !== 0x0d) return E400; // bare LF
    const c = buf[pos];
    if (c === 0x63 || c === 0x43) {
      // c / C
      if (lf - pos > 15 && matchName(buf, pos, CL_LO, CL_UP)) {
        const sep = buf[pos + 14];
        if (sep === 0x3a) {
          const v = parseContentLength(buf, pos + 14, lf - 1);
          if (v < 0 || (cl >= 0 && v !== cl)) return E400;
          cl = v;
        } else if (sep === 0x20 || sep === 0x09) return E400;
      }
    } else if (c === 0x74 || c === 0x54) {
      // t / T
      if (lf - pos > 18 && matchName(buf, pos, TE_LO, TE_UP)) {
        const sep = buf[pos + 17];
        if (sep === 0x3a) return E501;
        if (sep === 0x20 || sep === 0x09) return E400;
      }
    } else if (c === 0x20 || c === 0x09) {
      return E400; // obs-fold
    }
    pos = lf + 1;
  }
  if (cl > cfg.maxBodySize) return E413;

  // ── Commit request fields ──────────────────────────────────────
  req.method = parseMethod(buf, start, sp1 - start);
  req.url = buf.toString("utf8", urlStart, sp2);
  // Query string: find '?' in URL
  const qPos = req.url.indexOf("?");
  req.qIdx = qPos;
  req.pathEnd = qPos >= 0 ? qPos : req.url.length;
  // Header region for lazy getHeader()
  req[kHdrBuf] = buf;
  req[kHdrStart] = firstLF + 1;
  req[kHdrEnd] = headerEnd;

  if (cl > 0) {
    const bodyEnd = bodyStart + cl;
    if (bodyEnd > end) {
      conn.need = bodyEnd - offset; // incomplete body — wait for more data
      conn.scan = 0;
      return INCOMPLETE;
    }
    req.body = buf.toString("utf8", bodyStart, bodyEnd);
    return bodyEnd;
  }

  req.body = null;
  return bodyStart;
}
