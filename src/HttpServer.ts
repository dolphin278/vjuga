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
 *   kSweep: interval enforcing headersTimeout on stalled connections
 *   Per-connection: reusable Request + accumulation Buffer (no per-request alloc)
 *   Request.[kHdrBuf/kHdrStart/kHdrEnd]: raw header region for lazy getHeader()
 *
 * Design tradeoffs:
 * - Hand-rolled parser eliminates per-request allocation (no IncomingMessage,
 *   no headers object, no EventEmitter). Only URL and body are allocated.
 * - Framing is strict to prevent request smuggling: Content-Length is honored
 *   for every method; malformed framing (bare CR/LF, NUL, a line without ':')
 *   → 400, Transfer-Encoding → 501, oversized headers/body → 431/413, each
 *   followed by connection close.
 * - Response uses pre-computed prefix + string concat for single socket.write().
 * - Keep-alive and pipelining, one request in flight per connection: the next
 *   request is dispatched once the previous one is answered and the socket's
 *   write buffer has room. `Connection: close` / HTTP/1.0 end the connection
 *   after the response. No chunked TE, no upgrades.
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
const kConn: unique symbol = Symbol("conn");
const kSweep: unique symbol = Symbol("sweep");

const kHdrBuf: unique symbol = Symbol("hdrBuf");
const kHdrStart: unique symbol = Symbol("hdrStart");
const kHdrEnd: unique symbol = Symbol("hdrEnd");

// ── Public types ────────────────────────────────────────────────────

export interface HttpServer {
  [kServer]: net.Server;
  [kHandler]: Handler;
  [kConns]: Map<net.Socket, ConnState>;
  [kConfig]: Config;
  [kSweep]: ReturnType<typeof setInterval> | null;
}

/**
 * Parsed HTTP request. Reused per connection: its fields and getHeader()
 * stay valid until the request is answered, then the next request reuses
 * the object — do NOT retain references past the response.
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

/**
 * Request handler. Each request must be answered with exactly one call to
 * respond(), respondRaw() or respondBuffer() (now or later): those calls
 * mark the request complete. Requests on one connection are handled one at
 * a time — a pipelined request is not dispatched until the previous one is
 * answered, so responses always go out in request order. A request that is
 * never answered stalls its connection.
 */
export type Handler = (req: Request, socket: net.Socket) => void;

/**
 * Server limits and timeouts. All sizes in bytes (integers), all times in ms
 * (at most 2147483647). make() throws RangeError on an invalid value.
 */
export interface Options {
  /** Max request-line + header block size (>= 1); larger → 431 + close. Default 65536. */
  maxHeaderSize?: number;
  /** Max Content-Length (>= 0); larger → 413 + close. Default 1 MiB. */
  maxBodySize?: number;
  /**
   * Max time from the first byte of a request until its header block is
   * complete (slowloris guard); a stalled connection is destroyed. Checked
   * when data arrives and by a sweep every min(headersTimeout, 1000) ms
   * while listening. 0 disables. Default 60000.
   */
  headersTimeout?: number;
  /**
   * Socket inactivity timeout (no bytes read or written) after which an
   * idle connection is destroyed; 0 disables. Default 5000. Never fires
   * while a dispatched request still awaits its response.
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
  keepAliveTimeout: number;
  onError: (err: unknown, socket: net.Socket) => void;
  closing: boolean;
}

type ConnSocket = net.Socket & { [kConn]?: ConnState };

interface ConnState {
  buf: Buffer;
  used: number;
  /** Bytes needed at buf[0..] before re-parsing (pending body); 0 = unknown. */
  need: number;
  /** Resume position for the header-terminator search. */
  scan: number;
  /** Date.now() when the pending partial header block started; 0 = none. */
  hdrSince: number;
  /** Bytes at buf[0..] already dispatched, kept until their request is answered. */
  skip: number;
  /** Dispatch suspended until the socket drains or the request is answered. */
  paused: boolean;
  /** Dispatch suspended until the in-flight request is answered. */
  awaiting: boolean;
  /** Connection rejected/closed/ending — ignore further input. */
  dead: boolean;
  /** Keep the connection open after the current response (Connection header). */
  keepAlive: boolean;
  /** Requests dispatched but not yet answered via a respond helper (0 or 1). */
  inflight: number;
  /** An idle timeout fired while requests were in flight; re-arm later. */
  timeoutDeferred: boolean;
  cfg: Config;
  handler: Handler;
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
// Largest delay setTimeout/setInterval honor; larger ones fire after 1 ms
const MAX_TIMER_MS = 2147483647;
const MAX_SWEEP_INTERVAL = 1000;

// Header names / Connection options checked by the parser (lowercase)
const CL_NAME = Buffer.from("content-length");
const TE_NAME = Buffer.from("transfer-encoding");
const CONN_NAME = Buffer.from("connection");
const CLOSE_OPT = Buffer.from("close");
const KA_OPT = Buffer.from("keep-alive");

// parseConnection() result bits
const CONN_CLOSE = 1;
const CONN_KEEP_ALIVE = 2;

// Rewriting respondRaw() buffers for a closing connection
const KA_HEADER = Buffer.from("\r\nConnection: keep-alive\r\n");
const CLOSE_HEADER = Buffer.from("\r\nConnection: close\r\n");

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

function onTimeout(this: ConnSocket): void {
  const conn = this[kConn]!;
  if (conn.inflight > 0) {
    // A handler is still working: not idle. Re-armed once it responds.
    conn.timeoutDeferred = true;
    return;
  }
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

function makeConnState(cfg: Config, handler: Handler): ConnState {
  const conn: ConnState = {
    buf: Buffer.allocUnsafe(INITIAL_BUF_SIZE),
    used: 0,
    need: 0,
    scan: 0,
    hdrSince: 0,
    skip: 0,
    paused: false,
    awaiting: false,
    dead: false,
    keepAlive: true,
    inflight: 0,
    timeoutDeferred: false,
    cfg,
    handler,
    req: makeRequest(),
  };
  // Double-write mutable fields (see makeRequest)
  conn.used = 0;
  conn.need = 0;
  conn.scan = 0;
  conn.hdrSince = 0;
  conn.skip = 0;
  conn.paused = false;
  conn.awaiting = false;
  conn.dead = false;
  conn.keepAlive = true;
  conn.inflight = 0;
  conn.timeoutDeferred = false;
  return conn;
}

/** Validate an integer size option (NaN would silently disable `x > limit` checks). */
function sizeOption(name: string, value: number | undefined, def: number, min: number): number {
  const v = value ?? def;
  if (!Number.isSafeInteger(v) || v < min) {
    throw new RangeError(`HttpServer: ${name} must be an integer >= ${min}, got ${v}`);
  }
  return v;
}

/** Validate a timeout option: finite, >= 0, within the timer range. */
function timeOption(name: string, value: number | undefined, def: number): number {
  const v = value ?? def;
  // Written so NaN fails too
  if (!(v >= 0 && v <= MAX_TIMER_MS)) {
    throw new RangeError(`HttpServer: ${name} must be in [0, ${MAX_TIMER_MS}] ms, got ${v}`);
  }
  return v;
}

/**
 * Create an HttpServer with the given request handler.
 * The handler is called synchronously for each parsed request; an exception
 * it throws destroys that connection (reported via `options.onError`).
 * See {@link Options} for limits and timeouts; an invalid option (NaN,
 * negative, non-integer size, out-of-range timeout) throws RangeError.
 */
export function make(handler: Handler, options?: Options): HttpServer {
  const cfg: Config = {
    maxHeaderSize: sizeOption("maxHeaderSize", options?.maxHeaderSize, DEFAULT_MAX_HEADER_SIZE, 1),
    maxBodySize: sizeOption("maxBodySize", options?.maxBodySize, DEFAULT_MAX_BODY_SIZE, 0),
    headersTimeout: timeOption("headersTimeout", options?.headersTimeout, DEFAULT_HEADERS_TIMEOUT),
    keepAliveTimeout: timeOption(
      "keepAliveTimeout",
      options?.keepAliveTimeout,
      DEFAULT_KEEP_ALIVE_TIMEOUT,
    ),
    onError: options?.onError ?? noop,
    closing: false,
  };
  const conns = new Map<net.Socket, ConnState>();

  const tcpServer = net.createServer((socket: ConnSocket) => {
    // Disable Nagle's algorithm — small HTTP responses (e.g. {"ok":true})
    // must not be delayed waiting for more data to fill a TCP segment
    socket.setNoDelay(true);
    const conn = makeConnState(cfg, handler);
    socket[kConn] = conn; // lets the respond helpers find the connection
    conns.set(socket, conn);

    // Set once per connection: re-arming per request would allocate a timer
    if (cfg.keepAliveTimeout > 0) {
      socket.setTimeout(cfg.keepAliveTimeout);
      socket.on("timeout", onTimeout);
    }

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

    socket.on("close", () => {
      conn.dead = true;
      conns.delete(socket);
    });
    socket.on("error", noop);
  });

  const server: HttpServer = {
    [kServer]: tcpServer,
    [kHandler]: handler,
    [kConns]: conns,
    [kConfig]: cfg,
    [kSweep]: null,
  };
  server[kSweep] = null; // double-write (see makeRequest)

  return server;
}

/**
 * Destroy connections whose header block has been pending longer than
 * headersTimeout. One server-wide interval instead of a timer per request:
 * the per-request path only stamps conn.hdrSince, which costs nothing.
 */
function sweep(conns: Map<net.Socket, ConnState>, cfg: Config): void {
  const deadline = Date.now() - cfg.headersTimeout;
  for (const [socket, conn] of conns) {
    if (conn.hdrSince !== 0 && conn.hdrSince < deadline) {
      conn.dead = true;
      socket.destroy();
    }
  }
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
  if (conn.paused || needed < conn.need) {
    // Waiting for an async handler: the socket keeps reading (so a client
    // that disconnects is noticed) until a header block's worth is queued
    if (conn.awaiting && needed - conn.skip > cfg.maxHeaderSize) socket.pause();
    return;
  }

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

function resume(conn: ConnState, socket: net.Socket): void {
  conn.paused = false;
  // The handler may have ended or destroyed the socket after responding
  if (conn.dead || !socket.writable) {
    conn.dead = true;
    return;
  }
  socket.resume();
  try {
    processBuffer(conn, socket, conn.handler, conn.cfg);
  } catch (err) {
    fail(conn, socket, err, conn.cfg);
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────

/**
 * Start listening on the given port. Resolves when the server is ready.
 * Also starts the headersTimeout sweep (stopped once close() completes).
 */
export function listen(server: HttpServer, port: number, host?: string): Promise<void> {
  const cfg = server[kConfig];
  if (cfg.headersTimeout > 0 && server[kSweep] === null) {
    const sweeper = setInterval(
      sweep,
      Math.min(cfg.headersTimeout, MAX_SWEEP_INTERVAL),
      server[kConns],
      cfg,
    );
    sweeper.unref(); // never keeps the process alive on its own
    server[kSweep] = sweeper;
  }
  return new Promise<void>((resolve) => {
    server[kServer].listen(port, host ?? "127.0.0.1", () => resolve());
  });
}

/**
 * Close the server. Stops accepting connections and destroys idle ones
 * immediately. A connection with a partially received request or a response
 * still in flight is ended after its next response, which carries
 * `Connection: close`; pipelined requests behind it are dropped. A stalled
 * partial request is cut off by headersTimeout. Resolves when all
 * connections are terminated.
 */
export function close(server: HttpServer): Promise<void> {
  server[kConfig].closing = true;
  const done = new Promise<void>((resolve, reject) => {
    server[kServer].close((err) => {
      if (server[kSweep] !== null) {
        clearInterval(server[kSweep]);
        server[kSweep] = null;
      }
      /* node:coverage ignore next 2 */
      if (err) reject(err);
      else resolve();
    });
  });
  for (const [socket, conn] of server[kConns]) {
    if (conn.used !== 0 || conn.inflight !== 0) {
      conn.keepAlive = false; // closed after the next response
      continue;
    }
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
  const conn = (socket as ConnSocket)[kConn];
  if (conn !== undefined && !conn.keepAlive) {
    // Last response on this connection
    const text = STATUS_TEXT[status] ?? "Unknown";
    socket.write(
      `HTTP/1.1 ${status} ${text}\r\nContent-Type: ${contentType ?? JSON_CT}\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    );
  } else if (contentType === undefined || contentType === JSON_CT) {
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
  responded(socket, conn);
}

/**
 * Write a pre-computed response Buffer. Zero per-request allocation.
 * Use with precompute() for static or cached responses. On a connection
 * that closes after this response, a `Connection: keep-alive` header in
 * the buffer is sent as `Connection: close`.
 */
export function respondRaw(socket: net.Socket, response: Buffer): void {
  const conn = (socket as ConnSocket)[kConn];
  if (conn !== undefined && !conn.keepAlive) writeClosing(socket, response);
  else socket.write(response);
  responded(socket, conn);
}

/** Write `response` with its keep-alive header (if any) replaced by close. */
function writeClosing(socket: net.Socket, response: Buffer): void {
  const at = response.indexOf(KA_HEADER);
  if (at === -1 || at > response.indexOf(CRLFCRLF)) {
    socket.write(response);
    return;
  }
  socket.cork();
  socket.write(response.subarray(0, at));
  socket.write(CLOSE_HEADER);
  socket.write(response.subarray(at + KA_HEADER.length));
  socket.uncork();
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
  const conn = (socket as ConnSocket)[kConn];
  const connection = conn !== undefined && !conn.keepAlive ? "close" : "keep-alive";
  const text = STATUS_TEXT[status] ?? "Unknown";
  socket.cork();
  socket.write(
    `HTTP/1.1 ${status} ${text}\r\nContent-Type: ${contentType}\r\nConnection: ${connection}\r\nContent-Length: ${body.length}\r\n\r\n`,
  );
  socket.write(body);
  socket.uncork();
  responded(socket, conn);
}

/**
 * A response was written: retire the in-flight request, then end the
 * connection (Connection: close / HTTP/1.0 / close()) or resume dispatch of
 * pipelined requests held back while an async handler was working.
 */
function responded(socket: net.Socket, conn: ConnState | undefined): void {
  // Foreign socket, or more responses than requests: nothing to retire
  if (conn === undefined || conn.inflight === 0) return;
  conn.inflight = 0;
  if (conn.timeoutDeferred) {
    // An idle timeout fired while the handler was working: re-arm it
    conn.timeoutDeferred = false;
    socket.setTimeout(conn.cfg.keepAliveTimeout);
  }
  if (conn.dead) return;
  if (!conn.keepAlive) {
    conn.dead = true;
    socket.end(); // after the response just written
  } else if (conn.awaiting) {
    // Deferred so code after respond() (e.g. socket.destroy()) runs first,
    // and the next handler never runs inside the previous one's respond()
    conn.awaiting = false;
    process.nextTick(resume, conn, socket);
  }
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
  let offset = conn.skip;
  conn.skip = 0;
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
    conn.inflight = 1;
    handler(conn.req, socket);
    // The response closed the connection, or the handler ended/destroyed
    // the socket: dispatch nothing more
    if (conn.dead || !socket.writable) {
      conn.dead = true;
      return;
    }
    if (conn.inflight !== 0) {
      // Async handler: hold pipelined requests until it responds, so
      // responses stay in order and concurrency per connection is 1. The
      // buffer is not compacted: getHeader() still reads this request's
      // bytes at buf[..offset). responded() resumes dispatch. Reading
      // goes on (see onData) so a disconnect is still seen.
      conn.awaiting = true;
      conn.paused = true;
      conn.skip = offset;
      conn.need = 0;
      conn.scan = 0;
      conn.hdrSince = 0;
      return;
    }
    // Backpressure: stop dispatching while the peer is not reading
    if (socket.writableNeedDrain) {
      conn.paused = true;
      socket.pause();
      socket.once("drain", () => resume(conn, socket));
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

/**
 * True when buf[pos..pos+lo.length) equals `lo` ignoring ASCII case.
 * `| 0x20` folds letters: one load and compare per byte instead of checking
 * lower- and uppercase copies (measurably cheaper per request). The only non-letter in
 * these constants is '-', and the one other byte that folds to it (CR) never
 * occurs inside a validated name or value.
 */
function matchName(buf: Buffer, pos: number, lo: Buffer): boolean {
  for (let i = 0; i < lo.length; i++) {
    if ((buf[pos + i] | 0x20) !== lo[i]) return false;
  }
  return true;
}

/** True when buf[from..to) holds an LF not preceded by CR. */
function hasBareLF(buf: Buffer, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (buf[i] === 0x0a && buf[i - 1] !== 0x0d) return true;
  return false;
}

/**
 * Parse a Connection value (comma-separated options, OWS around each) from
 * the colon at `i` to the line's CR at `lineEnd`: CONN_CLOSE and/or
 * CONN_KEEP_ALIVE bits for the options present (case-insensitive).
 * keep-alive only matters for HTTP/1.0 (it is the 1.1 default), so 1.1
 * requests skip comparing it — the common `Connection: keep-alive` costs
 * one length check.
 */
function parseConnection(buf: Buffer, i: number, lineEnd: number, http10: boolean): number {
  let flags = 0;
  while (i < lineEnd) {
    i++; // skip ':' or ','
    while (i < lineEnd && (buf[i] === 0x20 || buf[i] === 0x09)) i++;
    const s = i;
    while (i < lineEnd && buf[i] !== 0x2c) i++;
    let e = i;
    while (e > s && (buf[e - 1] === 0x20 || buf[e - 1] === 0x09)) e--;
    if (e - s === 5 && matchName(buf, s, CLOSE_OPT)) flags |= CONN_CLOSE;
    else if (http10 && e - s === 10 && matchName(buf, s, KA_OPT)) flags |= CONN_KEEP_ALIVE;
  }
  return flags;
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
    // A bare LF can never be part of a valid header block, so reject it now
    // instead of waiting for a CRLFCRLF that may never come. Checked before
    // the size limit and only below it (as on the complete-block path), so
    // the outcome does not depend on how the stream was chunked.
    const limit = offset + cfg.maxHeaderSize;
    if (hasBareLF(buf, scan > start ? scan : start, end < limit ? end : limit)) return E400;
    // Counted from `offset` so a stream of empty lines cannot grow the buffer
    if (end - offset > cfg.maxHeaderSize) return E431;
    conn.need = 0;
    conn.scan = (end - 3 > start ? end - 3 : start) - offset;
    return INCOMPLETE;
  }
  const bodyStart = headerEnd + 4; // past \r\n\r\n
  if (bodyStart - offset > cfg.maxHeaderSize) {
    return hasBareLF(buf, start, offset + cfg.maxHeaderSize) ? E400 : E431;
  }

  // Byte scans below are plain JS loops: each Buffer#indexOf(byte) is a
  // native call costing more than scanning a short line inline. Every scan
  // stops by headerEnd at the latest, which holds the terminator's CR.

  // ── Request line: METHOD SP URL SP VERSION CRLF ───────────────
  // Token bytes are all > 0x20, so one compare per byte finds the delimiter
  // and rejects control bytes (bare CR, NUL, …) inside a token.
  let sp1 = start;
  let b = buf[sp1];
  while (b > 0x20) b = buf[++sp1];
  if (b !== 0x20 || sp1 === start) return E400; // no method / no space
  let sp2 = sp1 + 1;
  b = buf[sp2];
  while (b > 0x20) b = buf[++sp2];
  if (b !== 0x20 || sp2 === sp1 + 1) return E400; // no URL / no space
  let cr = sp2 + 1;
  b = buf[cr];
  while (b > 0x20) b = buf[++cr];
  // Non-empty version, line ends in CRLF
  if (b !== 0x0d || cr === sp2 + 1 || buf[cr + 1] !== 0x0a) return E400;
  const firstLF = cr + 1;
  const urlStart = sp1 + 1;
  // "HTTP/1.0": no keep-alive unless asked for (RFC 9112 §9.3)
  const http10 =
    cr - sp2 === 9 && buf[cr - 3] === 0x31 && buf[cr - 2] === 0x2e && buf[cr - 1] === 0x30;

  // ── Header lines: NAME ":" VALUE CRLF ──────────────────────────
  // Every line is validated: a bare CR or NUL could be read as a line break
  // by getHeader() or a front end (header spoofing / request smuggling), so
  // it is a 400 like a bare LF. Two tight loops, one compare per byte for the
  // common bytes: the name runs to ':' (no SP/CTL allowed, RFC 9112 §5.1,
  // which also rejects obs-fold and an empty name), the value to its CR.
  let cl = -1;
  let te = false;
  let connection = 0;
  let pos = firstLF + 1;
  const linesEnd = headerEnd + 2;
  while (pos < linesEnd) {
    let colon = pos;
    b = buf[colon];
    while (b > 0x20 && b !== 0x3a) b = buf[++colon];
    if (b !== 0x3a || colon === pos) return E400;
    let lineEnd = colon + 1;
    b = buf[lineEnd];
    for (;;) {
      while (b > 0x0d) b = buf[++lineEnd];
      if (b === 0x0d) {
        if (buf[lineEnd + 1] === 0x0a) break;
        return E400; // bare CR
      }
      if (b === 0x0a || b === 0x00) return E400; // bare LF, NUL
      b = buf[++lineEnd]; // HTAB or another control byte: tolerated
    }
    // Framing-relevant names, picked by length before any byte compare
    const nameLen = colon - pos;
    if (nameLen === 14) {
      if (matchName(buf, pos, CL_NAME)) {
        const v = parseContentLength(buf, colon, lineEnd);
        if (v < 0 || (cl >= 0 && v !== cl)) return E400;
        cl = v;
      }
    } else if (nameLen === 10) {
      if (matchName(buf, pos, CONN_NAME)) {
        connection |= parseConnection(buf, colon, lineEnd, http10);
      }
    } else if (nameLen === 17 && matchName(buf, pos, TE_NAME)) {
      // 501 is decided after the whole block is checked, so a later bad
      // line is a 400 whether or not the block arrived in one chunk
      te = true;
    }
    pos = lineEnd + 2;
  }
  if (te) return E501;
  if (cl > cfg.maxBodySize) return E413;

  // ── Commit request fields ──────────────────────────────────────
  conn.keepAlive =
    (http10 ? connection === CONN_KEEP_ALIVE : (connection & CONN_CLOSE) === 0) && !cfg.closing;
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
