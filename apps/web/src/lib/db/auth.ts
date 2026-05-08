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
      .prepare("SELECT id, email, name, apple_sub FROM users WHERE id = ? LIMIT 1")
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

export function getUserByEmail(email: string): User | null {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  return safeWriteQuery((db) => {
    const row = db
      .prepare(
        "SELECT id, email, name, apple_sub FROM users WHERE LOWER(email) = ? LIMIT 1"
      )
      .get(normalized) as User | undefined;
    return row ?? null;
  });
}

/**
 * Find or insert a user keyed by email. Used by CF Access on the web side —
 * lets web requests resolve to the same row a SIWA-authenticated iOS request
 * already created (assuming SIWA stamped the email on first login).
 *
 * Email is matched case-insensitively but stored verbatim on insert.
 */
export function findOrCreateUserByEmail(email: string): User {
  const trimmed = email.trim();
  if (!trimmed) throw new Error("Email is required");
  const db = openWrite();
  if (!db) throw new Error("Database unavailable");
  try {
    const existing = db
      .prepare(
        "SELECT id, email, name, apple_sub FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1"
      )
      .get(trimmed) as User | undefined;
    if (existing) return existing;

    const result = db
      .prepare("INSERT INTO users (email) VALUES (?)")
      .run(trimmed);
    return {
      id: Number(result.lastInsertRowid),
      email: trimmed,
      name: null,
      apple_sub: null,
    };
  } finally {
    db.close();
  }
}

/**
 * Find a user by Apple `sub` claim, or insert a new row with that sub.
 *
 * Resolution order on miss:
 *   1. If an `email` is provided and matches an existing row, claim that row by
 *      stamping `apple_sub` onto it. This is the link that lets a CF-Access
 *      session (web) and a SIWA session (iOS) resolve to the same `user.id`.
 *   2. Otherwise insert a fresh row.
 *
 * If the Apple-sub row exists but has no email yet and an email is now
 * provided, persist it. Apple only sends email on first authentication.
 */
export function upsertUserByAppleSub(appleSub: string, email?: string | null): User {
  const db = openWrite();
  if (!db) throw new Error("Database unavailable");
  try {
    const bySub = db
      .prepare("SELECT id, email, name, apple_sub FROM users WHERE apple_sub = ? LIMIT 1")
      .get(appleSub) as User | undefined;
    if (bySub) {
      if (email && !bySub.email) {
        db.prepare("UPDATE users SET email = ? WHERE id = ?").run(email, bySub.id);
        bySub.email = email;
      }
      return bySub;
    }

    if (email) {
      const byEmail = db
        .prepare(
          "SELECT id, email, name, apple_sub FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1"
        )
        .get(email) as User | undefined;
      if (byEmail) {
        db.prepare("UPDATE users SET apple_sub = ? WHERE id = ?").run(appleSub, byEmail.id);
        byEmail.apple_sub = appleSub;
        return byEmail;
      }
    }

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
