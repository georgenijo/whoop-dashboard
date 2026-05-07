import "server-only";
import { randomUUID } from "node:crypto";
import { openWrite, safeWriteQuery } from "./connection";

export type User = {
  id: number;
  email: string | null;
  name: string | null;
  apple_sub?: string | null;
};

export type Session = {
  id: number;
  user_id: number;
  token: string;
  expires_at: string;
};

export function getUserById(id: number): User | null {
  return safeWriteQuery((db) => {
    const row = db
      .prepare("SELECT id, email, name FROM users WHERE id = ? LIMIT 1")
      .get(id) as User | undefined;
    return row ?? null;
  });
}

export function getSessionByToken(token: string): Session | null {
  return safeWriteQuery((db) => {
    const row = db
      .prepare("SELECT id, user_id, token, expires_at FROM sessions WHERE token = ? LIMIT 1")
      .get(token) as Session | undefined;
    return row ?? null;
  });
}

export function createSession(userId: number): { token: string; expiresAt: string } {
  const db = openWrite();
  if (!db) throw new Error("Database unavailable");
  try {
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare("INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)").run(
      userId,
      token,
      expiresAt
    );
    return { token, expiresAt };
  } finally {
    db.close();
  }
}

export function getPrimaryUser(): User | null {
  return getUserById(1);
}

export function getUserByAppleSub(appleSub: string): User | null {
  return safeWriteQuery((db) => {
    const row = db
      .prepare("SELECT id, email, name, apple_sub FROM users WHERE apple_sub = ? LIMIT 1")
      .get(appleSub) as User | undefined;
    return row ?? null;
  });
}

/**
 * Find a user by Apple `sub` claim, or insert a new row with that sub.
 * Returns the resolved user. Optional `email` is recorded only on first insert
 * (Apple only sends email on the very first authentication for a given app).
 */
export function upsertUserByAppleSub(appleSub: string, email?: string | null): User {
  const db = openWrite();
  if (!db) throw new Error("Database unavailable");
  try {
    const existing = db
      .prepare("SELECT id, email, name, apple_sub FROM users WHERE apple_sub = ? LIMIT 1")
      .get(appleSub) as User | undefined;
    if (existing) return existing;

    const result = db
      .prepare("INSERT INTO users (apple_sub, email) VALUES (?, ?)")
      .run(appleSub, email ?? null);
    const id = Number(result.lastInsertRowid);
    return {
      id,
      email: email ?? null,
      name: null,
      apple_sub: appleSub,
    };
  } finally {
    db.close();
  }
}
