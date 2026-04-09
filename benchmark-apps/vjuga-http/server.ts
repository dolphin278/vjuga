/**
 * vjuga-http server — uses vjuga's HttpServer module (raw TCP, hand-rolled parser)
 * instead of node:http. Same vjuga patterns as the optimized server plus the
 * HttpServer module itself, demonstrating how bypassing node:http eliminates
 * per-request overhead.
 *
 * Patterns applied:
 * - HttpServer for zero-overhead HTTP handling (no IncomingMessage, no EventEmitter)
 * - RadixTree for O(log k) route dispatch
 * - BufferizedFunction("io") for request batching with CPU cache locality
 * - Query deduplication within batches via numeric key Map
 * - LRUCache for bounded session store
 * - Pre-computed responses via HttpServer.precompute()
 * - Result tuples for typed error handling
 * - safeParse for prototype-pollution protection
 */

import * as net from "node:net";
import { createDatabase, hashPassword, type DB } from "../shared/seed.ts";
import { randomUUID } from "node:crypto";
import * as LRUCache from "../../src/LRUCache.ts";
import * as RadixTree from "../../src/RadixTree.ts";
import * as Result from "../../src/Result.ts";
import * as JSON_ from "../../src/JSON.ts";
import * as BufferizedFunction from "../../src/BufferizedFunction.ts";
import * as HttpServer from "../../src/HttpServer.ts";

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

// ── Session store — LRUCache ─────────────────────────────────────────
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
    STATIC_FILES.set(name, { body: buf, contentType: ct });
  }
}

// ── Pre-computed responses ───────────────────────────────────────────

const HEALTH_RESPONSE = HttpServer.precompute(200, '{"ok":true}');
const ERR_NOT_FOUND = HttpServer.precompute(404, '{"error":"Not found"}');
const ERR_USER_NOT_FOUND = HttpServer.precompute(404, '{"error":"User not found"}');
const ERR_INVALID_JSON = HttpServer.precompute(400, '{"error":"Invalid JSON"}');
const ERR_MISSING_USER_PASS = HttpServer.precompute(400, '{"error":"Missing user or pass"}');
const ERR_INVALID_CREDS = HttpServer.precompute(401, '{"error":"Invalid credentials"}');
const ERR_MISSING_FIELDS = HttpServer.precompute(400, '{"error":"Missing fields"}');
const ERR_INVALID_REQ = HttpServer.precompute(400, '{"error":"Invalid request"}');
const OK_RESPONSE = HttpServer.precompute(200, '{"ok":true}');

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
function extractSessionToken(req: HttpServer.Request): string | null {
  const cookie = HttpServer.getHeader(req, "cookie");
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

// ── Route handlers ──────────────────────────────────────────────────

type RouteHandler = (req: HttpServer.Request, socket: net.Socket) => void;

function handleHealth(_req: HttpServer.Request, socket: net.Socket): void {
  HttpServer.respondRaw(socket, HEALTH_RESPONSE);
}

function handleDebugMem(_req: HttpServer.Request, socket: net.Socket): void {
  if (typeof globalThis.gc === "function") globalThis.gc();
  HttpServer.respond(socket, 200, JSON.stringify(process.memoryUsage()));
}

function handleBatchStats(_req: HttpServer.Request, socket: net.Socket): void {
  HttpServer.respond(socket, 200, JSON.stringify({
    getUserBatches: batchGetUserBatches,
    getUserRequests: batchGetUserCount,
    getUserAvgBatchSize: batchGetUserBatches > 0 ? (batchGetUserCount / batchGetUserBatches).toFixed(1) : 0,
    getUsersBatches: batchGetUsersBatches,
    getUsersRequests: batchGetUsersCount,
    getUsersAvgBatchSize: batchGetUsersBatches > 0 ? (batchGetUsersCount / batchGetUsersBatches).toFixed(1) : 0,
  }));
}

function handleGetUsers(req: HttpServer.Request, socket: net.Socket): void {
  const offsetStr = getQueryParam(req.url, req.qIdx, "offset");
  const limitStr = getQueryParam(req.url, req.qIdx, "limit");
  const offset = offsetStr ? parseInt(offsetStr, 10) : 0;
  const limit = limitStr ? parseInt(limitStr, 10) : 20;
  batchGetUsers({ limit, offset, socket });
}

// ── Batched handlers ────────────────────────────────────────────────

interface BatchedGetUserReq { id: number; socket: net.Socket }
interface BatchedGetUsersReq { limit: number; offset: number; socket: net.Socket }

const batchGetUser = BufferizedFunction.make<BatchedGetUserReq>((requests) => {
  batchGetUserBatches++;
  batchGetUserCount += requests.length;
  const rows = new Array(requests.length);
  for (let i = 0; i < requests.length; i++) {
    rows[i] = stmtGetUser.get(requests[i].id);
  }
  for (let i = 0; i < requests.length; i++) {
    if (!rows[i]) {
      HttpServer.respondRaw(requests[i].socket, ERR_USER_NOT_FOUND);
    } else {
      HttpServer.respond(requests[i].socket, 200, JSON.stringify(rows[i]));
    }
  }
}, "io");

const batchGetUsers = BufferizedFunction.make<BatchedGetUsersReq>((requests) => {
  batchGetUsersBatches++;
  batchGetUsersCount += requests.length;
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
  for (let i = 0; i < requests.length; i++) {
    HttpServer.respond(requests[i].socket, 200, JSON.stringify(results[i]));
  }
}, "io");

let batchGetUserCount = 0;
let batchGetUserBatches = 0;
let batchGetUsersCount = 0;
let batchGetUsersBatches = 0;

// ── RadixTree router ────────────────────────────────────────────────

const GET_ROUTES = RadixTree.make<RouteHandler>();
RadixTree.insert(GET_ROUTES, "/health", handleHealth);
RadixTree.insert(GET_ROUTES, "/debug/mem", handleDebugMem);
RadixTree.insert(GET_ROUTES, "/debug/batch-stats", handleBatchStats);
RadixTree.insert(GET_ROUTES, "/users", handleGetUsers);

// ── Dispatch helpers ────────────────────────────────────────────────

function extractIdFromPath(url: string, prefixLen: number, endIdx: number): number {
  let id = 0;
  for (let i = prefixLen; i < endIdx; i++) {
    const c = url.charCodeAt(i);
    if (c < 48 || c > 57) return -1;
    id = id * 10 + (c - 48);
  }
  return endIdx > prefixLen ? id : -1;
}

// ── Request handler ─────────────────────────────────────────────────

function handleRequest(req: HttpServer.Request, socket: net.Socket): void {
  const { method, url, pathEnd, qIdx } = req;

  if (method === HttpServer.GET) {
    const pathname = qIdx === -1 ? url : url.substring(0, pathEnd);
    const handler = RadixTree.lookup(GET_ROUTES, pathname);
    if (handler) {
      handler(req, socket);
      return;
    }

    // /users/:id
    if (pathEnd > 7 && url.charCodeAt(1) === 117 && url.startsWith("/users/")) {
      const id = extractIdFromPath(url, 7, pathEnd);
      if (id >= 0) {
        batchGetUser({ id, socket });
        return;
      }
    }

    // /files/:name
    if (pathEnd > 7 && url.charCodeAt(1) === 102 && url.startsWith("/files/")) {
      const name = url.substring(7, pathEnd);
      const file = STATIC_FILES.get(name);
      if (file) {
        HttpServer.respondBuffer(socket, 200, file.body, file.contentType);
      } else {
        HttpServer.respondRaw(socket, ERR_NOT_FOUND);
      }
      return;
    }

    HttpServer.respondRaw(socket, ERR_NOT_FOUND);
    return;
  }

  if (method === HttpServer.DELETE && pathEnd > 7 && url.startsWith("/users/")) {
    const id = extractIdFromPath(url, 7, pathEnd);
    if (id >= 0) {
      const result = stmtDeleteUser.run(id);
      if (result.changes === 0) {
        HttpServer.respondRaw(socket, ERR_USER_NOT_FOUND);
      } else {
        HttpServer.respondRaw(socket, OK_RESPONSE);
      }
      return;
    }
  }

  if (method === HttpServer.POST) {
    // /auth/login
    if (pathEnd === 11 && url.charCodeAt(1) === 97 && url.startsWith("/auth/login")) {
      handleLogin(req, socket);
      return;
    }
    // /auth/logout
    if (pathEnd === 12 && url.charCodeAt(1) === 97 && url.startsWith("/auth/logout")) {
      const token = extractSessionToken(req);
      if (token) sessionDestroy(token);
      // Custom response with Set-Cookie header
      socket.write(
        'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: keep-alive\r\nSet-Cookie: session=; HttpOnly; Path=/; Max-Age=0\r\nContent-Length: 11\r\n\r\n{"ok":true}',
      );
      return;
    }
    // POST /users
    if (pathEnd === 6 && url.startsWith("/users")) {
      handleCreateUser(req, socket);
      return;
    }
  }

  if (method === HttpServer.PUT && pathEnd > 7 && url.startsWith("/users/")) {
    const id = extractIdFromPath(url, 7, pathEnd);
    if (id >= 0) {
      handleUpdateUser(req, socket, id);
      return;
    }
  }

  HttpServer.respondRaw(socket, ERR_NOT_FOUND);
}

function handleLogin(req: HttpServer.Request, socket: net.Socket): void {
  if (!req.body) {
    HttpServer.respondRaw(socket, ERR_INVALID_JSON);
    return;
  }
  const parsed = parseJSON(req.body);
  if (!parsed[0]) {
    HttpServer.respondRaw(socket, ERR_INVALID_JSON);
    return;
  }
  const body = parsed[1];
  const user = body.user as string | undefined;
  const pass = body.pass as string | undefined;
  if (!user || !pass) {
    HttpServer.respondRaw(socket, ERR_MISSING_USER_PASS);
    return;
  }
  const row = stmtFindUser.get(user) as { id: number; password_hash: string } | undefined;
  if (!row || row.password_hash !== hashPassword(pass)) {
    HttpServer.respondRaw(socket, ERR_INVALID_CREDS);
    return;
  }
  const token = sessionCreate(row.id);
  const tokenBody = `{"token":"${token}"}`;
  socket.write(
    `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: keep-alive\r\nSet-Cookie: session=${token}; HttpOnly; Path=/\r\nContent-Length: ${Buffer.byteLength(tokenBody)}\r\n\r\n${tokenBody}`,
  );
}

function handleCreateUser(req: HttpServer.Request, socket: net.Socket): void {
  if (!req.body) {
    HttpServer.respondRaw(socket, ERR_INVALID_JSON);
    return;
  }
  const parsed = parseJSON(req.body);
  if (!parsed[0]) {
    HttpServer.respondRaw(socket, ERR_INVALID_JSON);
    return;
  }
  const body = parsed[1];
  const username = body.username as string | undefined;
  const password = body.password as string | undefined;
  const email = body.email as string | undefined;
  if (!username || !password || !email) {
    HttpServer.respondRaw(socket, ERR_MISSING_FIELDS);
    return;
  }
  try {
    const result = stmtCreateUser.run(username, hashPassword(password), email, Date.now());
    HttpServer.respond(socket, 201, JSON.stringify({ id: Number(result.lastInsertRowid), username, email }));
  } catch {
    HttpServer.respondRaw(socket, ERR_INVALID_REQ);
  }
}

function handleUpdateUser(req: HttpServer.Request, socket: net.Socket, id: number): void {
  const existing = stmtGetUser.get(id) as { id: number; username: string; email: string } | undefined;
  if (!existing) {
    HttpServer.respondRaw(socket, ERR_USER_NOT_FOUND);
    return;
  }
  if (!req.body) {
    HttpServer.respondRaw(socket, ERR_INVALID_JSON);
    return;
  }
  const parsed = parseJSON(req.body);
  if (!parsed[0]) {
    HttpServer.respondRaw(socket, ERR_INVALID_JSON);
    return;
  }
  const body = parsed[1];
  const username = (body.username as string) || existing.username;
  const email = (body.email as string) || existing.email;
  stmtUpdateUser.run(username, email, id);
  HttpServer.respond(socket, 200, JSON.stringify({ id, username, email }));
}

// ── Server ───────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3500", 10);

const server = HttpServer.make(handleRequest);

await HttpServer.listen(server, PORT, "127.0.0.1");
if (process.send) process.send({ type: "ready", port: PORT });
console.log(`vjuga-http server listening on :${PORT}`);

process.on("SIGTERM", () => {
  HttpServer.close(server).then(() => process.exit(0));
});
