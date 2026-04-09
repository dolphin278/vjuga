/**
 * Express server — idiomatic Express.js implementation with standard patterns.
 *
 * Uses: express.json() middleware, express.Router, standard error handling,
 * cookie-parsing via regex, class-based session store.
 */

import express from "express";
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
const app = express();

app.use(express.json());

// Health
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Memory debug
app.get("/debug/mem", (_req, res) => {
  if (typeof globalThis.gc === "function") globalThis.gc();
  res.json(process.memoryUsage());
});

// Auth
app.post("/auth/login", (req, res) => {
  const { user, pass } = req.body;
  if (!user || !pass) {
    res.status(400).json({ error: "Missing user or pass" });
    return;
  }
  const row = stmtFindUser.get(user) as { id: number; password_hash: string } | undefined;
  if (!row || row.password_hash !== hashPassword(pass)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const token = sessionStore.create(row.id);
  res.cookie("session", token, { httpOnly: true, path: "/" });
  res.json({ token });
});

app.post("/auth/logout", (req, res) => {
  const token = extractSessionToken(req.headers.cookie);
  if (token) sessionStore.destroy(token);
  res.cookie("session", "", { httpOnly: true, path: "/", maxAge: 0 });
  res.json({ ok: true });
});

// Users
app.get("/users", (req, res) => {
  const offset = parseInt(req.query.offset as string || "0", 10);
  const limit = parseInt(req.query.limit as string || "20", 10);
  const rows = stmtGetUsers.all(limit, offset);
  res.json(rows);
});

app.get("/users/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = stmtGetUser.get(id);
  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(row);
});

app.post("/users", (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password || !email) {
    res.status(400).json({ error: "Missing fields" });
    return;
  }
  const result = stmtCreateUser.run(username, hashPassword(password), email, Date.now());
  res.status(201).json({ id: Number(result.lastInsertRowid), username, email });
});

app.put("/users/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = stmtGetUser.get(id) as { id: number; username: string; email: string } | undefined;
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const username = req.body.username || existing.username;
  const email = req.body.email || existing.email;
  stmtUpdateUser.run(username, email, id);
  res.json({ id, username, email });
});

app.delete("/users/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = stmtDeleteUser.run(id);
  if (result.changes === 0) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ ok: true });
});

// Static files
app.get("/files/:name", (req, res) => {
  const content = STATIC_FILES[req.params.name];
  if (!content) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  const ct = req.params.name.endsWith(".json") ? "application/json" : "text/plain";
  res.type(ct).send(content);
});

// ── Server ───────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3300", 10);

app.listen(PORT, () => {
  if (process.send) process.send({ type: "ready", port: PORT });
  console.log(`express server listening on :${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  process.exit(0);
});
