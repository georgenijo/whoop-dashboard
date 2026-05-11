import "server-only";
import { open, type DB } from "./connection";

// ---------------------------------------------------------------------------
// Phase D — per-user query wrapper.
//
// Every read against the five Whoop domain tables (recovery, cycles, sleep,
// workouts, daily_summary) MUST route through `forUser(userId)`. The wrapper
// binds `userId` as the trailing `?` placeholder of the caller's SQL.
//
// Call-site convention (enforced by the CI test in scoped.test.ts):
//
//   forUser(uid).all<Row>(
//     "SELECT date, hrv FROM recovery WHERE date >= ? AND user_id = ?",
//     "2025-01-01",
//   );
//
// The wrapper appends `uid` after every positional parameter the caller
// passes — the LAST `?` placeholder in the SQL (by position, NOT by
// string-end) must be the `user_id` one. Trailing `ORDER BY`, `LIMIT N`
// (LIMIT inlined as a SQL literal — see `safeDays`), or any other clause
// after `user_id = ?` is fine as long as it contains no further `?`.
// We DO NOT parse the SQL; the dev-mode invariant below catches the common
// errors (missing user_id placeholder, OR a user_id placeholder that isn't
// the last positional `?`) at first call.
// ---------------------------------------------------------------------------

const USER_ID_BEFORE_LAST_PLACEHOLDER_RE = /\buser_id\s*=\s*$/i;

function assertUserIdPlaceholder(sql: string): void {
  if (process.env.NODE_ENV === "production") return;
  const lastQ = sql.lastIndexOf("?");
  if (lastQ === -1 || !USER_ID_BEFORE_LAST_PLACEHOLDER_RE.test(sql.slice(0, lastQ))) {
    throw new Error(
      `[scoped] the trailing positional '?' in the SQL must be the 'user_id' ` +
        `placeholder so the wrapper binds the tenant correctly. ` +
        `Missing 'user_id = ?' or any further '?' after it will cause silent ` +
        `param drift. Got: ${sql}`,
    );
  }
}

export type ScopedDb = {
  /**
   * Escape hatch for multi-statement read flows. Receives the underlying
   * (read-only) better-sqlite3 handle and the bound userId. Returns null if
   * the DB file is missing. Callers MUST still scope every prepared
   * statement they construct — there is no automatic binding here.
   */
  read<T>(fn: (db: DB, userId: number) => T): T | null;
  /** Bind params + the wrapper's userId as the trailing `?`. Returns an
   *  empty array if the DB is missing. */
  all<T>(sql: string, ...params: unknown[]): T[];
  /** Bind params + the wrapper's userId as the trailing `?`. Returns
   *  undefined if the row doesn't exist or the DB is missing. */
  get<T>(sql: string, ...params: unknown[]): T | undefined;
};

export function forUser(userId: number): ScopedDb {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error(`[scoped] invalid userId: ${userId}`);
  }
  return {
    read<T>(fn: (db: DB, uid: number) => T): T | null {
      const db = open();
      if (!db) return null;
      try {
        return fn(db, userId);
      } finally {
        db.close();
      }
    },
    all<T>(sql: string, ...params: unknown[]): T[] {
      assertUserIdPlaceholder(sql);
      const db = open();
      if (!db) return [];
      try {
        return db.prepare(sql).all(...params, userId) as T[];
      } finally {
        db.close();
      }
    },
    get<T>(sql: string, ...params: unknown[]): T | undefined {
      assertUserIdPlaceholder(sql);
      const db = open();
      if (!db) return undefined;
      try {
        return db.prepare(sql).get(...params, userId) as T | undefined;
      } finally {
        db.close();
      }
    },
  };
}
