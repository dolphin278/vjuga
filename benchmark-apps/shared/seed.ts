/** Database seeding — shared schema and 1000-user dataset for both servers. */

import { createHash } from "node:crypto";

const SEED_COUNT = 1000;
const IS_BUN = typeof globalThis.Bun !== "undefined";

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

/** Minimal interface shared by node:sqlite DatabaseSync and bun:sqlite Database. */
export interface DB {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

async function openDatabase(): Promise<DB> {
  if (IS_BUN) {
    // bun:sqlite — dynamic import to avoid node:sqlite resolution error
    const mod = await import("bun:sqlite");
    return new (mod.Database as unknown as new (path: string) => DB)(":memory:");
  }
  const mod = await import("node:sqlite");
  return new (mod.DatabaseSync as unknown as new (path: string) => DB)(":memory:");
}

export async function createDatabase(): Promise<DB> {
  const db = await openDatabase();

  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX idx_sessions_user ON sessions(user_id);
    CREATE INDEX idx_sessions_expires ON sessions(expires_at);
  `);

  const insert = db.prepare(
    "INSERT INTO users (username, password_hash, email, created_at) VALUES (?, ?, ?, ?)",
  );
  const now = Date.now();

  for (let i = 0; i < SEED_COUNT; i++) {
    insert.run(`user${i}`, hashPassword(`pass${i}`), `user${i}@example.com`, now - i * 1000);
  }

  return db;
}

export { hashPassword };
