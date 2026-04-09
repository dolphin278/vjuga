/**
 * Naive server — idiomatic Node.js HTTP server with standard patterns.
 *
 * Uses: regex routing, class instances, try/catch error handling,
 * new URL() per request, Buffer.concat for body reading, fs.readFileSync
 * per static file request, string-keyed Maps.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createDatabase, hashPassword, type DB } from "../shared/seed.ts";
import { randomBytes } from "node:crypto";

// ── Database ──────────────────────────────────────────────────────────
const db: DB = await createDatabase();

// ── Prepared statements ──────────────────────────────────────────────
const stmtGetUsers = db.prepare("SELECT id, username, email, created_at FROM users ORDER BY id LIMIT ? OFFSET ?");
const stmtGetUser = db.prepare("SELECT id, username, email, created_at FROM users WHERE id = ?");
const stmtFindUser = db.prepare("SELECT id, password_hash FROM users WHERE username = ?");
const stmtCreateUser = db.prepare("INSERT INTO users (username, password_hash, email, created_at) VALUES (?, ?, ?, ?)");
const stmtUpdateUser = db.prepare("UPDATE users SET username = ?, email = ? WHERE id = ?");
const stmtDeleteUser = db.prepare("DELETE FROM users WHERE id = ?");
const stmtCreateSession = db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)");
const stmtGetSession = db.prepare("SELECT token, user_id, expires_at FROM sessions WHERE token = ?");
const stmtDeleteSession = db.prepare("DELETE FROM sessions WHERE token = ?");

// ── Session class ────────────────────────────────────────────────────
class SessionStore {
  private sessions = new Map<string, { userId: number; expiresAt: number }>();

  create(userId: number): string {
    const token = randomBytes(16).toString("hex");
    const expiresAt = Date.now() + 3600_000;
    stmtCreateSession.run(token, userId, expiresAt);
    this.sessions.set(token, { userId, expiresAt });
    return token;
  }

  validate(token: string): number | null {
    const cached = this.sessions.get(token);
    if (cached) {
      if (cached.expiresAt > Date.now()) return cached.userId;
      this.sessions.delete(token);
      stmtDeleteSession.run(token);
      return null;
    }
    const row = stmtGetSession.get(token) as { token: string; user_id: number; expires_at: number } | undefined;
    if (!row) return null;
    if (row.expires_at <= Date.now()) {
      stmtDeleteSession.run(token);
      return null;
    }
    this.sessions.set(token, { userId: row.user_id, expiresAt: row.expires_at });
    return row.user_id;
  }

  destroy(token: string): void {
    this.sessions.delete(token);
    stmtDeleteSession.run(token);
  }
}

const sessionStore = new SessionStore();

// ── Static files (read from "disk" each time, simulated with in-memory map) ──
const STATIC_FILES: Record<string, string> = {};

// Generate a 100KB text file
{
  const line = "The quick brown fox jumps over the lazy dog. ";
  let content = "";
  while (content.length < 100_000) content += line;
  STATIC_FILES["large.txt"] = content.slice(0, 100_000);
  STATIC_FILES["small.txt"] = "Hello, World!";
  STATIC_FILES["data.json"] = JSON.stringify({ items: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item${i}` })) });
}

// ── Helpers ──────────────────────────────────────────────────────────
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJSON(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJSON(res, status, { error: message });
}

function extractSessionToken(req: IncomingMessage): string | null {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  const match = cookie.match(/session=([^;]+)/);
  return match ? match[1] : null;
}

function requireAuth(req: IncomingMessage): number | null {
  const token = extractSessionToken(req);
  if (!token) return null;
  return sessionStore.validate(token);
}

// ── Route handlers ───────────────────────────────────────────────────
async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const bodyStr = await readBody(req);
    const body = JSON.parse(bodyStr);
    const { user, pass } = body;
    if (!user || !pass) {
      sendError(res, 400, "Missing user or pass");
      return;
    }
    const row = stmtFindUser.get(user) as { id: number; password_hash: string } | undefined;
    if (!row || row.password_hash !== hashPassword(pass)) {
      sendError(res, 401, "Invalid credentials");
      return;
    }
    const token = sessionStore.create(row.id);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": `session=${token}; HttpOnly; Path=/`,
    });
    res.end(JSON.stringify({ token }));
  } catch {
    sendError(res, 400, "Invalid JSON");
  }
}

async function handleLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const token = extractSessionToken(req);
  if (token) sessionStore.destroy(token);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Set-Cookie": "session=; HttpOnly; Path=/; Max-Age=0",
  });
  res.end(JSON.stringify({ ok: true }));
}

function handleGetUsers(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url!, "http://localhost");
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const limit = parseInt(url.searchParams.get("limit") || "20", 10);
  const rows = stmtGetUsers.all(limit, offset);
  sendJSON(res, 200, rows);
}

function handleGetUser(res: ServerResponse, id: number): void {
  const row = stmtGetUser.get(id);
  if (!row) {
    sendError(res, 404, "User not found");
    return;
  }
  sendJSON(res, 200, row);
}

async function handleCreateUser(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const bodyStr = await readBody(req);
    const body = JSON.parse(bodyStr);
    const { username, password, email } = body;
    if (!username || !password || !email) {
      sendError(res, 400, "Missing fields");
      return;
    }
    const result = stmtCreateUser.run(username, hashPassword(password), email, Date.now());
    sendJSON(res, 201, { id: Number(result.lastInsertRowid), username, email });
  } catch {
    sendError(res, 400, "Invalid request");
  }
}

async function handleUpdateUser(req: IncomingMessage, res: ServerResponse, id: number): Promise<void> {
  try {
    const existing = stmtGetUser.get(id) as { id: number; username: string; email: string } | undefined;
    if (!existing) {
      sendError(res, 404, "User not found");
      return;
    }
    const bodyStr = await readBody(req);
    const body = JSON.parse(bodyStr);
    const username = body.username || existing.username;
    const email = body.email || existing.email;
    stmtUpdateUser.run(username, email, id);
    sendJSON(res, 200, { id, username, email });
  } catch {
    sendError(res, 400, "Invalid request");
  }
}

function handleDeleteUser(res: ServerResponse, id: number): void {
  const result = stmtDeleteUser.run(id);
  if (result.changes === 0) {
    sendError(res, 404, "User not found");
    return;
  }
  sendJSON(res, 200, { ok: true });
}

function handleStaticFile(res: ServerResponse, name: string): void {
  // Simulates reading from disk each time (no cache)
  const content = STATIC_FILES[name];
  if (!content) {
    sendError(res, 404, "File not found");
    return;
  }
  const ct = name.endsWith(".json") ? "application/json" : "text/plain";
  res.writeHead(200, { "Content-Type": ct, "Content-Length": Buffer.byteLength(content) });
  res.end(content);
}

// ── Router ───────────────────────────────────────────────────────────
const USER_ID_RE = /^\/users\/(\d+)$/;
const FILE_RE = /^\/files\/(.+)$/;

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url!, "http://localhost");
  const pathname = url.pathname;
  const method = req.method!;

  // Health
  if (pathname === "/health" && method === "GET") {
    sendJSON(res, 200, { ok: true });
    return;
  }

  // Memory debug endpoint
  if (pathname === "/debug/mem" && method === "GET") {
    if (typeof globalThis.gc === "function") globalThis.gc();
    sendJSON(res, 200, process.memoryUsage());
    return;
  }

  // Auth routes
  if (pathname === "/auth/login" && method === "POST") {
    await handleLogin(req, res);
    return;
  }
  if (pathname === "/auth/logout" && method === "POST") {
    await handleLogout(req, res);
    return;
  }

  // Users collection
  if (pathname === "/users") {
    if (method === "GET") {
      handleGetUsers(req, res);
      return;
    }
    if (method === "POST") {
      await handleCreateUser(req, res);
      return;
    }
  }

  // Users by ID
  const userMatch = pathname.match(USER_ID_RE);
  if (userMatch) {
    const id = parseInt(userMatch[1], 10);
    if (method === "GET") {
      handleGetUser(res, id);
      return;
    }
    if (method === "PUT") {
      await handleUpdateUser(req, res, id);
      return;
    }
    if (method === "DELETE") {
      handleDeleteUser(res, id);
      return;
    }
  }

  // Static files
  const fileMatch = pathname.match(FILE_RE);
  if (fileMatch) {
    handleStaticFile(res, fileMatch[1]);
    return;
  }

  sendError(res, 404, "Not found");
}

// ── Server ───────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3100", 10);

const server = createServer((req, res) => {
  handleRequest(req, res).catch(() => {
    if (!res.headersSent) sendError(res, 500, "Internal error");
  });
});

server.listen(PORT, () => {
  // Signal ready to parent process
  if (process.send) process.send({ type: "ready", port: PORT });
  console.log(`naive server listening on :${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
