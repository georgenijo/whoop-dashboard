import "server-only";
import { randomUUID } from "node:crypto";
import { openWrite, safeWriteQuery, type DB } from "./connection";

export type User = {
  id: number;
  email: string | null;
  name: string | null;
  apple_sub?: string | null;
  timezone?: string | null;
};

export type Session = {
  id: number;
  user_id: number;
  token: string;
  expires_at: string;
};

// Tables with a `user_id` FK to users(id). Kept in sync with connection.ts.
// Used by upsertUserByAppleSub (split-brain merge) and the migration script.
const USER_FK_TABLES = ["chat_threads", "body_measurements", "sessions"] as const;

export function getUserById(id: number): User | null {
  return safeWriteQuery((db) => {
    const row = db
      .prepare("SELECT id, email, name, apple_sub, timezone FROM users WHERE id = ? LIMIT 1")
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
      .prepare("SELECT id, email, name, apple_sub, timezone FROM users WHERE apple_sub = ? LIMIT 1")
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
        "SELECT id, email, name, apple_sub, timezone FROM users WHERE LOWER(email) = ? LIMIT 1"
      )
      .get(normalized) as User | undefined;
    return row ?? null;
  });
}

function selectUserByEmail(db: DB, email: string): User | undefined {
  return db
    .prepare(
      "SELECT id, email, name, apple_sub, timezone FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1"
    )
    .get(email) as User | undefined;
}

export function findOrCreateUserByEmail(email: string, tz?: string | null): User {
  const trimmed = email.trim();
  if (!trimmed) throw new Error("Email is required");
  const db = openWrite();
  if (!db) throw new Error("Database unavailable");
  try {
    // Wrapped in a transaction so a concurrent insert that loses the unique
    // index race can re-SELECT inside the same logical operation. Relies on
    // the partial unique index on LOWER(email) (see connection.ts).
    const upsert = db.transaction((value: string): User => {
      const existing = selectUserByEmail(db, value);
      if (existing) {
        // Only overwrite an existing tz when the caller provided a non-null
        // value AND it changed — null/undefined means "no opinion, leave it".
        if (tz != null && existing.timezone !== tz) {
          db.prepare("UPDATE users SET timezone = ? WHERE id = ?").run(tz, existing.id);
          existing.timezone = tz;
        }
        return existing;
      }
      try {
        const result = db
          .prepare("INSERT INTO users (email, timezone) VALUES (?, ?)")
          .run(value, tz ?? null);
        return {
          id: Number(result.lastInsertRowid),
          email: value,
          name: null,
          apple_sub: null,
          timezone: tz ?? null,
        };
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT") {
          const winner = selectUserByEmail(db, value);
          if (winner) {
            if (tz != null && winner.timezone !== tz) {
              db.prepare("UPDATE users SET timezone = ? WHERE id = ?").run(tz, winner.id);
              winner.timezone = tz;
            }
            return winner;
          }
        }
        throw err;
      }
    });
    return upsert(trimmed);
  } finally {
    db.close();
  }
}

/**
 * Resolve a SIWA login to a user row.
 *
 * Three states matter:
 *   - bySub exists, byEmail does not → return bySub (backfill email if missing).
 *   - byEmail exists, bySub does not → claim that row by stamping apple_sub.
 *   - both exist as distinct rows → split-brain. Merge byEmail INTO bySub by
 *     repointing every user_id FK at bySub.id, then delete byEmail. Apple sub
 *     is the more authoritative key (Apple guarantees stability; email can
 *     change at the IdP).
 *
 * Apple only sends `email` on first authentication, so the merge case only
 * fires once (the first time SIWA runs after CF Access has already created a
 * user row by email).
 */
export function upsertUserByAppleSub(
  appleSub: string,
  email?: string | null,
  tz?: string | null,
): User {
  const db = openWrite();
  if (!db) throw new Error("Database unavailable");
  try {
    const txn = db.transaction((): User => {
      const bySub = db
        .prepare("SELECT id, email, name, apple_sub, timezone FROM users WHERE apple_sub = ? LIMIT 1")
        .get(appleSub) as User | undefined;

      const byEmail =
        email != null && email.length > 0
          ? selectUserByEmail(db, email)
          : undefined;

      // bySub exists.
      if (bySub) {
        if (byEmail && byEmail.id !== bySub.id) {
          mergeUserInto(db, byEmail.id, bySub.id);
          if (email && bySub.email !== email) {
            db.prepare("UPDATE users SET email = ? WHERE id = ?").run(email, bySub.id);
            bySub.email = email;
          }
          applyTzUpdate(db, bySub, tz);
          return bySub;
        }
        if (email && !bySub.email) {
          db.prepare("UPDATE users SET email = ? WHERE id = ?").run(email, bySub.id);
          bySub.email = email;
        }
        applyTzUpdate(db, bySub, tz);
        return bySub;
      }

      // No sub-row. Claim an email-row if one exists.
      if (byEmail) {
        db.prepare("UPDATE users SET apple_sub = ? WHERE id = ?").run(appleSub, byEmail.id);
        byEmail.apple_sub = appleSub;
        applyTzUpdate(db, byEmail, tz);
        return byEmail;
      }

      // Fresh insert.
      const result = db
        .prepare("INSERT INTO users (apple_sub, email, timezone) VALUES (?, ?, ?)")
        .run(appleSub, email ?? null, tz ?? null);
      return {
        id: Number(result.lastInsertRowid),
        email: email ?? null,
        name: null,
        apple_sub: appleSub,
        timezone: tz ?? null,
      };
    });
    return txn();
  } finally {
    db.close();
  }
}

/**
 * Persist `tz` on `user` only when the caller supplied a value that differs
 * from what's already stored. null/undefined is "no opinion" — never clobber
 * a previously-saved TZ with a missing field on a later sign-in.
 */
function applyTzUpdate(db: DB, user: User, tz: string | null | undefined): void {
  if (tz == null) return;
  if (user.timezone === tz) return;
  db.prepare("UPDATE users SET timezone = ? WHERE id = ?").run(tz, user.id);
  user.timezone = tz;
}

/**
 * Repoint every `user_id` FK from `fromId` onto `toId`, then delete `fromId`.
 * Caller must wrap in a transaction.
 */
function mergeUserInto(db: DB, fromId: number, toId: number): void {
  const moves: Record<string, number> = {};
  for (const table of USER_FK_TABLES) {
    const result = db
      .prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`)
      .run(toId, fromId);
    moves[table] = result.changes;
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(fromId);
  console.log(
    `[upsertUserByAppleSub] merged user id=${fromId} → id=${toId}; ` +
      Object.entries(moves)
        .map(([t, n]) => `${t}=${n}`)
        .join(", ")
  );
}
