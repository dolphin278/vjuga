/**
 * Optimized server — applies vjuga patterns for V8-aware, allocation-conscious
 * HTTP serving.
 *
 * Patterns applied (informed by CPU + heap profiling, V8 --trace-opt/--trace-deopt):
 * - RadixTree for O(log k) route dispatch — handlers stored as direct function
 *   refs (NOT closures) with uniform signatures to avoid megamorphic call ICs
 * - BufferizedFunction("io") for request batching — collects requests arriving
 *   in the same I/O poll phase and processes them in tight loops for CPU cache
 *   locality (instruction cache stays hot). No Promise/MemoryPool overhead.
 * - Query deduplication within batches — numeric key Map avoids redundant SQLite
 *   queries when multiple requests share the same (limit, offset) parameters
 * - LRUCache for bounded session store with typed-array spine
 * - Sync dispatch path for non-body routes (avoids async/microtask overhead)
 * - Result tuples for typed error handling (parseJSON returns Result)
 * - safeParse with indexOf fast-path for prototype-pollution protection
 * - Pre-serialized error responses (eliminates template literal allocation)
 * - Flat array headers in writeHead (avoids per-request object literal allocation)
 * - Pre-encoded static file Buffers with frozen header objects
 * - crypto.randomUUID() instead of randomBytes().toString() (no intermediate Buffer)
 * - Module-level free functions for monomorphic ICs
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createDatabase, hashPassword, type DB } from "../shared/seed.ts";
import { randomUUID } from "node:crypto";
import * as LRUCache from "../../src/LRUCache.ts";
import * as RadixTree from "../../src/RadixTree.ts";
import * as Result from "../../src/Result.ts";
import * as JSON_ from "../../src/JSON.ts";
import * as BufferizedFunction from "../../src/BufferizedFunction.ts";

// ── Database ──────────────────────────────────────────────────────────
const db = await createDatabase();

// ── Prepared statements ──────────────────────────────────────────────
const stmtGetUsers = db.prepare("SELECT id, username, email, created_at FROM users ORDER BY id LIMIT ? OFFSET ?");
const stmtGetUser = db.prepare("SELECT id, username, email, created_at FROM users WHERE id = ?");
const stmtFindUser = db.prepare("SELECT id, password_hash FROM users WHERE username = ?");
const stmtCreateUser = db.prepare("INSERT INTO users (username, password_hash, email, created_at) VALUES (?, ?, ?, ?)");
const stmtUpdateUser = db.prepare("UPDATE users SET username = ?, email = ? WHERE id = ?");
const stmtDeleteUser = db.prepare("DELETE FROM users WHERE id = ?");
const stmtCreateSession = db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)");
const stmtDeleteSession = db.prepare("DELETE FROM sessions WHERE token = ?");

// ── Session store — LRUCache with typed-array spine ──────────────────
const SESSION_CAPACITY = 10_000;

interface SessionEntry { userId: number; expiresAt: number }

const sessions = LRUCache.make<string, SessionEntry>(SESSION_CAPACITY);

function sessionCreate(userId: number): string {
  const token = randomUUID();
  const expiresAt = Date.now() + 3600_000;
  stmtCreateSession.run(token, userId, expiresAt);
  LRUCache.set(sessions, token, { userId, expiresAt });
  return token;
}

function sessionDestroy(token: string): void {
  LRUCache.del(sessions, token);
  stmtDeleteSession.run(token);
}

// ── Static files — pre-loaded + pre-encoded as Buffers ───────────────
interface StaticFile {
  body: Buffer;
  contentType: string;
  length: number;
}

const STATIC_FILES = new Map<string, StaticFile>();

{
  const line = "The quick brown fox jumps over the lazy dog. ";
  let largeTxt = "";
  while (largeTxt.length < 100_000) largeTxt += line;
  largeTxt = largeTxt.slice(0, 100_000);

  const dataJson = JSON.stringify({ items: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item${i}` })) });

  const files: [string, string, string][] = [
    ["large.txt", largeTxt, "text/plain"],
    ["small.txt", "Hello, World!", "text/plain"],
    ["data.json", dataJson, "application/json"],
  ];
  for (const [name, content, ct] of files) {
    const buf = Buffer.from(content, "utf8");
    STATIC_FILES.set(name, { body: buf, contentType: ct, length: buf.length });
  }
}

// ── Pre-serialized responses with frozen header objects ──────────────
const JSON_CT = "application/json";

const HEALTH_BODY = '{"ok":true}';
const HEALTH_BUF_LEN = Buffer.byteLength(HEALTH_BODY);

const ERR_NOT_FOUND = '{"error":"Not found"}';
const ERR_USER_NOT_FOUND = '{"error":"User not found"}';
const ERR_INVALID_JSON = '{"error":"Invalid JSON"}';
const ERR_MISSING_USER_PASS = '{"error":"Missing user or pass"}';
const ERR_INVALID_CREDS = '{"error":"Invalid credentials"}';
const ERR_MISSING_FIELDS = '{"error":"Missing fields"}';
const ERR_INVALID_REQ = '{"error":"Invalid request"}';

function makeHeaders(contentLength: number): Record<string, string | number> {
  return Object.freeze({ "Content-Type": JSON_CT, "Content-Length": contentLength });
}

const HDRS_HEALTH = makeHeaders(HEALTH_BUF_LEN);
const HDRS_NOT_FOUND = makeHeaders(Buffer.byteLength(ERR_NOT_FOUND));
const HDRS_USER_NOT_FOUND = makeHeaders(Buffer.byteLength(ERR_USER_NOT_FOUND));
const HDRS_INVALID_JSON = makeHeaders(Buffer.byteLength(ERR_INVALID_JSON));
const HDRS_MISSING_USER_PASS = makeHeaders(Buffer.byteLength(ERR_MISSING_USER_PASS));
const HDRS_INVALID_CREDS = makeHeaders(Buffer.byteLength(ERR_INVALID_CREDS));
const HDRS_MISSING_FIELDS = makeHeaders(Buffer.byteLength(ERR_MISSING_FIELDS));
const HDRS_INVALID_REQ = makeHeaders(Buffer.byteLength(ERR_INVALID_REQ));

// ── Response helpers ─────────────────────────────────────────────────

function writePrebuilt(
  res: ServerResponse, status: number,
  body: string, hdrs: Record<string, string | number>,
): void {
  res.writeHead(status, hdrs);
  res.end(body);
}

function writeJSONData(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, [
    "Content-Type", JSON_CT,
    "Content-Length", String(Buffer.byteLength(body)),
  ]);
  res.end(body);
}

// ── Body reading — collect into string ───────────────────────────────
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// ── JSON parse — safeParse with indexOf fast-path + Result types ─────
function parseJSON(str: string): Result.Result<Record<string, unknown>, string> {
  const result = JSON_.safeParse(str);
  if (!result[0]) return result;
  return Result.ok(result[1] as Record<string, unknown>);
}

// ── URL parsing — manual, no new URL() allocation ───────────────────

function getQueryParam(url: string, qStart: number, name: string): string | null {
  if (qStart === -1) return null;
  const nameEq = name + "=";
  const nameEqLen = nameEq.length;

  let pos = qStart + 1;
  while (pos < url.length) {
    if (url.startsWith(nameEq, pos)) {
      const valStart = pos + nameEqLen;
      const ampIdx = url.indexOf("&", valStart);
      return ampIdx === -1 ? url.substring(valStart) : url.substring(valStart, ampIdx);
    }
    const nextAmp = url.indexOf("&", pos);
    if (nextAmp === -1) break;
    pos = nextAmp + 1;
  }
  return null;
}

// ── Cookie parsing — manual, no regex ────────────────────────────────
function extractSessionToken(req: IncomingMessage): string | null {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  const start = cookie.indexOf("session=");
  if (start === -1) return null;
  if (start > 0 && cookie.charCodeAt(start - 1) !== 32 && cookie.charCodeAt(start - 1) !== 59) {
    return null;
  }
  const valStart = start + 8;
  const semiIdx = cookie.indexOf(";", valStart);
  return semiIdx === -1 ? cookie.substring(valStart) : cookie.substring(valStart, semiIdx);
}

// ── Route handlers — uniform signature, module-level free functions ──
// All handlers take (req, res, url, pathEnd, qIdx) so they can be stored
// directly in the RadixTree without closure wrappers. This keeps the
// handler call site monomorphic.

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  pathEnd: number,
  qIdx: number,
) => void;

function handleHealth(
  _req: IncomingMessage, res: ServerResponse,
  _url: string, _pathEnd: number, _qIdx: number,
): void {
  writePrebuilt(res, 200, HEALTH_BODY, HDRS_HEALTH);
}

function handleDebugMem(
  _req: IncomingMessage, res: ServerResponse,
  _url: string, _pathEnd: number, _qIdx: number,
): void {
  if (typeof globalThis.gc === "function") globalThis.gc();
  writeJSONData(res, 200, process.memoryUsage());
}

function handleBatchStats(
  _req: IncomingMessage, res: ServerResponse,
  _url: string, _pathEnd: number, _qIdx: number,
): void {
  writeJSONData(res, 200, {
    getUserBatches: batchGetUserBatches,
    getUserRequests: batchGetUserCount,
    getUserAvgBatchSize: batchGetUserBatches > 0 ? (batchGetUserCount / batchGetUserBatches).toFixed(1) : 0,
    getUsersBatches: batchGetUsersBatches,
    getUsersRequests: batchGetUsersCount,
    getUsersAvgBatchSize: batchGetUsersBatches > 0 ? (batchGetUsersCount / batchGetUsersBatches).toFixed(1) : 0,
  });
}

function handleGetUsers(
  _req: IncomingMessage, res: ServerResponse,
  url: string, _pathEnd: number, qIdx: number,
): void {
  const offsetStr = getQueryParam(url, qIdx, "offset");
  const limitStr = getQueryParam(url, qIdx, "limit");
  const offset = offsetStr ? parseInt(offsetStr, 10) : 0;
  const limit = limitStr ? parseInt(limitStr, 10) : 20;
  batchGetUsers({ limit, offset, res });
}

function handleGetUser(res: ServerResponse, id: number): void {
  const row = stmtGetUser.get(id);
  if (!row) {
    writePrebuilt(res, 404, ERR_USER_NOT_FOUND, HDRS_USER_NOT_FOUND);
    return;
  }
  writeJSONData(res, 200, row);
}

async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const bodyStr = await readBody(req);
  const parsed = parseJSON(bodyStr);
  if (!parsed[0]) {
    writePrebuilt(res, 400, ERR_INVALID_JSON, HDRS_INVALID_JSON);
    return;
  }
  const body = parsed[1];
  const user = body.user as string | undefined;
  const pass = body.pass as string | undefined;
  if (!user || !pass) {
    writePrebuilt(res, 400, ERR_MISSING_USER_PASS, HDRS_MISSING_USER_PASS);
    return;
  }
  const row = stmtFindUser.get(user) as { id: number; password_hash: string } | undefined;
  if (!row || row.password_hash !== hashPassword(pass)) {
    writePrebuilt(res, 401, ERR_INVALID_CREDS, HDRS_INVALID_CREDS);
    return;
  }
  const token = sessionCreate(row.id);
  const tokenBody = `{"token":"${token}"}`;
  res.writeHead(200, {
    "Content-Type": JSON_CT,
    "Content-Length": Buffer.byteLength(tokenBody),
    "Set-Cookie": `session=${token}; HttpOnly; Path=/`,
  });
  res.end(tokenBody);
}

function handleLogout(req: IncomingMessage, res: ServerResponse): void {
  const token = extractSessionToken(req);
  if (token) sessionDestroy(token);
  res.writeHead(200, {
    "Content-Type": JSON_CT,
    "Content-Length": HEALTH_BUF_LEN,
    "Set-Cookie": "session=; HttpOnly; Path=/; Max-Age=0",
  });
  res.end(HEALTH_BODY);
}

async function handleCreateUser(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const bodyStr = await readBody(req);
  const parsed = parseJSON(bodyStr);
  if (!parsed[0]) {
    writePrebuilt(res, 400, ERR_INVALID_JSON, HDRS_INVALID_JSON);
    return;
  }
  const body = parsed[1];
  const username = body.username as string | undefined;
  const password = body.password as string | undefined;
  const email = body.email as string | undefined;
  if (!username || !password || !email) {
    writePrebuilt(res, 400, ERR_MISSING_FIELDS, HDRS_MISSING_FIELDS);
    return;
  }
  const result = stmtCreateUser.run(username, hashPassword(password), email, Date.now());
  writeJSONData(res, 201, { id: Number(result.lastInsertRowid), username, email });
}

async function handleUpdateUser(req: IncomingMessage, res: ServerResponse, id: number): Promise<void> {
  const existing = stmtGetUser.get(id) as { id: number; username: string; email: string } | undefined;
  if (!existing) {
    writePrebuilt(res, 404, ERR_USER_NOT_FOUND, HDRS_USER_NOT_FOUND);
    return;
  }
  const bodyStr = await readBody(req);
  const parsed = parseJSON(bodyStr);
  if (!parsed[0]) {
    writePrebuilt(res, 400, ERR_INVALID_JSON, HDRS_INVALID_JSON);
    return;
  }
  const body = parsed[1];
  const username = (body.username as string) || existing.username;
  const email = (body.email as string) || existing.email;
  stmtUpdateUser.run(username, email, id);
  writeJSONData(res, 200, { id, username, email });
}

function handleDeleteUser(res: ServerResponse, id: number): void {
  const result = stmtDeleteUser.run(id);
  if (result.changes === 0) {
    writePrebuilt(res, 404, ERR_USER_NOT_FOUND, HDRS_USER_NOT_FOUND);
    return;
  }
  writePrebuilt(res, 200, HEALTH_BODY, HDRS_HEALTH);
}

function handleStaticFile(res: ServerResponse, name: string): void {
  const file = STATIC_FILES.get(name);
  if (!file) {
    writePrebuilt(res, 404, ERR_NOT_FOUND, HDRS_NOT_FOUND);
    return;
  }
  res.writeHead(200, { "Content-Type": file.contentType, "Content-Length": file.length });
  res.end(file.body);
}

// ── RadixTree router — direct function refs, no closures ─────────────
// Handlers are stored as direct function references with a uniform
// signature (RouteHandler). This avoids the closure-wrapper pattern that
// previously caused the handler call site to go megamorphic.

const GET_ROUTES = RadixTree.make<RouteHandler>();

// Register exact-match GET routes with uniform-signature handlers
RadixTree.insert(GET_ROUTES, "/health", handleHealth);
RadixTree.insert(GET_ROUTES, "/debug/mem", handleDebugMem);
RadixTree.insert(GET_ROUTES, "/debug/batch-stats", handleBatchStats);
RadixTree.insert(GET_ROUTES, "/users", handleGetUsers);

// ── Batched handlers — tight-loop query + serialize for cache locality ─
// BufferizedFunction with "io" scheduling (setImmediate) collects all requests
// arriving in the same I/O poll phase and processes them in a tight loop.
// Using BufferizedFunction instead of BatchExecutor avoids per-request Promise
// and MemoryPool overhead — we write directly to res, no return value needed.

interface BatchedGetUserReq { id: number; res: ServerResponse }
interface BatchedGetUsersReq { limit: number; offset: number; res: ServerResponse }

const batchGetUser = BufferizedFunction.make<BatchedGetUserReq>((requests) => {
  batchGetUserBatches++;
  batchGetUserCount += requests.length;
  // Phase 1: tight loop — all SQLite queries (instruction cache stays hot)
  const rows = new Array(requests.length);
  for (let i = 0; i < requests.length; i++) {
    rows[i] = stmtGetUser.get(requests[i].id);
  }
  // Phase 2: tight loop — all JSON serialization + response writing
  for (let i = 0; i < requests.length; i++) {
    if (!rows[i]) {
      writePrebuilt(requests[i].res, 404, ERR_USER_NOT_FOUND, HDRS_USER_NOT_FOUND);
    } else {
      writeJSONData(requests[i].res, 200, rows[i]);
    }
  }
}, "io");

const batchGetUsers = BufferizedFunction.make<BatchedGetUsersReq>((requests) => {
  batchGetUsersBatches++;
  batchGetUsersCount += requests.length;
  // Deduplicate: group by (limit, offset) — run one query per unique combo.
  // With ~100 possible offsets and batch ~193, this eliminates ~50% of queries.
  // Numeric key avoids string allocation: limit * 1_000_000 + offset.
  const queryCache = new Map<number, unknown[]>();
  const results = new Array(requests.length);
  for (let i = 0; i < requests.length; i++) {
    const key = requests[i].limit * 1_000_000 + requests[i].offset;
    let cached = queryCache.get(key);
    if (!cached) {
      cached = stmtGetUsers.all(requests[i].limit, requests[i].offset);
      queryCache.set(key, cached);
    }
    results[i] = cached;
  }
  // Phase 2: tight loop — all JSON serialization + response writing
  for (let i = 0; i < requests.length; i++) {
    writeJSONData(requests[i].res, 200, results[i]);
  }
}, "io");

// ── Batch stats instrumentation ──────────────────────────────────────
let batchGetUserCount = 0;
let batchGetUserBatches = 0;
let batchGetUsersCount = 0;
let batchGetUsersBatches = 0;

// (stats are updated by the batch functions above via closure)

// ── Dispatch helpers ─────────────────────────────────────────────────

function extractIdFromPath(url: string, prefixLen: number, endIdx: number): number {
  let id = 0;
  for (let i = prefixLen; i < endIdx; i++) {
    const c = url.charCodeAt(i);
    if (c < 48 || c > 57) return -1;
    id = id * 10 + (c - 48);
  }
  return endIdx > prefixLen ? id : -1;
}

function dispatchSync(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  pathEnd: number,
  qIdx: number,
  method: string,
): boolean {
  // GET routes — try RadixTree exact match first
  if (method === "GET") {
    const pathname = qIdx === -1 ? url : url.substring(0, pathEnd);
    const handler = RadixTree.lookup(GET_ROUTES, pathname);
    if (handler) {
      handler(req, res, url, pathEnd, qIdx);
      return true;
    }

    // Parameterized: /users/:id
    if (pathEnd > 7 && url.charCodeAt(1) === 117 /* u */ && url.startsWith("/users/")) {
      const id = extractIdFromPath(url, 7, pathEnd);
      if (id >= 0) {
        batchGetUser({ id, res });
        return true;
      }
    }

    // /files/:name
    if (pathEnd > 7 && url.charCodeAt(1) === 102 /* f */ && url.startsWith("/files/")) {
      handleStaticFile(res, url.substring(7, pathEnd));
      return true;
    }

    writePrebuilt(res, 404, ERR_NOT_FOUND, HDRS_NOT_FOUND);
    return true;
  }

  // DELETE /users/:id
  if (method === "DELETE" && pathEnd > 7 && url.startsWith("/users/")) {
    const id = extractIdFromPath(url, 7, pathEnd);
    if (id >= 0) { handleDeleteUser(res, id); return true; }
  }

  // POST and PUT need body — fall through to async
  return false;
}

async function dispatchAsync(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  pathEnd: number,
  method: string,
): Promise<void> {
  if (method === "POST") {
    // /auth/login (pathEnd 11) or /auth/logout (pathEnd 12)
    if (url.charCodeAt(1) === 97 /* a */) {
      if (pathEnd === 11 && url.startsWith("/auth/login")) {
        await handleLogin(req, res);
        return;
      }
      if (pathEnd === 12 && url.startsWith("/auth/logout")) {
        handleLogout(req, res);
        return;
      }
    }
    // POST /users
    if (pathEnd === 6 && url.startsWith("/users")) {
      await handleCreateUser(req, res);
      return;
    }
  }

  // PUT /users/:id
  if (method === "PUT" && pathEnd > 7 && url.startsWith("/users/")) {
    const id = extractIdFromPath(url, 7, pathEnd);
    if (id >= 0) {
      await handleUpdateUser(req, res, id);
      return;
    }
  }

  writePrebuilt(res, 404, ERR_NOT_FOUND, HDRS_NOT_FOUND);
}

// ── Server ───────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3200", 10);

const server = createServer((req, res) => {
  const url = req.url!;
  const method = req.method!;
  const qIdx = url.indexOf("?");
  const pathEnd = qIdx === -1 ? url.length : qIdx;

  // Try sync dispatch first — avoids async/microtask overhead for GET routes
  if (dispatchSync(req, res, url, pathEnd, qIdx, method)) return;

  // Fall through to async for body-reading routes
  dispatchAsync(req, res, url, pathEnd, method).catch(() => {
    if (!res.headersSent) writePrebuilt(res, 500, ERR_INVALID_REQ, HDRS_INVALID_REQ);
  });
});

server.listen(PORT, () => {
  if (process.send) process.send({ type: "ready", port: PORT });
  console.log(`optimized server listening on :${PORT}`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
