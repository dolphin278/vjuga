/**
 * Fastify server — idiomatic Fastify implementation with standard patterns.
 *
 * Uses: built-in JSON parsing, schema-less routes, Fastify's optimized
 * routing and serialization pipeline.
 */

import Fastify from "fastify";
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

// ── Session store ────────────────────────────────────────────────────
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

// ── Static files ────────────────────────────────────────────────────
const STATIC_FILES: Record<string, string> = {};

{
  const line = "The quick brown fox jumps over the lazy dog. ";
  let content = "";
  while (content.length < 100_000) content += line;
  STATIC_FILES["large.txt"] = content.slice(0, 100_000);
  STATIC_FILES["small.txt"] = "Hello, World!";
  STATIC_FILES["data.json"] = JSON.stringify({ items: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item${i}` })) });
}

// ── Helpers ──────────────────────────────────────────────────────────
function extractSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/session=([^;]+)/);
  return match ? match[1] : null;
}

// ── App ─────────────────────────────────────────────────────────────
const fastify = Fastify({ logger: false });

// Health
fastify.get("/health", async () => {
  return { ok: true };
});

// Memory debug
fastify.get("/debug/mem", async () => {
  if (typeof globalThis.gc === "function") globalThis.gc();
  return process.memoryUsage();
});

// Auth
fastify.post("/auth/login", async (request, reply) => {
  const body = request.body as Record<string, string>;
  const { user, pass } = body;
  if (!user || !pass) {
    return reply.status(400).send({ error: "Missing user or pass" });
  }
  const row = stmtFindUser.get(user) as { id: number; password_hash: string } | undefined;
  if (!row || row.password_hash !== hashPassword(pass)) {
    return reply.status(401).send({ error: "Invalid credentials" });
  }
  const token = sessionStore.create(row.id);
  return reply
    .header("Set-Cookie", `session=${token}; HttpOnly; Path=/`)
    .send({ token });
});

fastify.post("/auth/logout", async (request, reply) => {
  const token = extractSessionToken(request.headers.cookie);
  if (token) sessionStore.destroy(token);
  return reply
    .header("Set-Cookie", "session=; HttpOnly; Path=/; Max-Age=0")
    .send({ ok: true });
});

// Users
fastify.get("/users", async (request) => {
  const query = request.query as Record<string, string>;
  const offset = parseInt(query.offset || "0", 10);
  const limit = parseInt(query.limit || "20", 10);
  return stmtGetUsers.all(limit, offset);
});

fastify.get("/users/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const row = stmtGetUser.get(parseInt(id, 10));
  if (!row) {
    return reply.status(404).send({ error: "User not found" });
  }
  return row;
});

fastify.post("/users", async (request, reply) => {
  const body = request.body as Record<string, string>;
  const { username, password, email } = body;
  if (!username || !password || !email) {
    return reply.status(400).send({ error: "Missing fields" });
  }
  const result = stmtCreateUser.run(username, hashPassword(password), email, Date.now());
  return reply.status(201).send({ id: Number(result.lastInsertRowid), username, email });
});

fastify.put("/users/:id", async (request, reply) => {
  const { id: idStr } = request.params as { id: string };
  const id = parseInt(idStr, 10);
  const existing = stmtGetUser.get(id) as { id: number; username: string; email: string } | undefined;
  if (!existing) {
    return reply.status(404).send({ error: "User not found" });
  }
  const body = request.body as Record<string, string>;
  const username = body.username || existing.username;
  const email = body.email || existing.email;
  stmtUpdateUser.run(username, email, id);
  return { id, username, email };
});

fastify.delete("/users/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const result = stmtDeleteUser.run(parseInt(id, 10));
  if (result.changes === 0) {
    return reply.status(404).send({ error: "User not found" });
  }
  return { ok: true };
});

// Static files
fastify.get("/files/:name", async (request, reply) => {
  const { name } = request.params as { name: string };
  const content = STATIC_FILES[name];
  if (!content) {
    return reply.status(404).send({ error: "File not found" });
  }
  const ct = name.endsWith(".json") ? "application/json" : "text/plain";
  return reply.type(ct).send(content);
});

// ── Server ───────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3400", 10);

await fastify.listen({ port: PORT, host: "127.0.0.1" });
if (process.send) process.send({ type: "ready", port: PORT });
console.log(`fastify server listening on :${PORT}`);

process.on("SIGTERM", () => {
  fastify.close().then(() => process.exit(0));
});
