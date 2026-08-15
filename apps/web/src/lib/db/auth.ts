import "server-only";
import { randomUUID } from "node:crypto";
import { hasColumn, hasTable, openWrite, safeWriteQuery, type DB } from "./connection";

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

// Tables whose `user_id` column identifies the owning user — most declare it
// as an FK to users(id), but a couple (see the #502 entries below) don't and
// are listed anyway. Kept in sync with connection.ts. Used by
// upsertUserByAppleSub (split-brain merge) and the migration script.
//
// Any table listed here is repointed with a bare `UPDATE ... SET user_id`, so
// a table may only be added if `user_id` is NOT part of a PRIMARY KEY or
// UNIQUE constraint — otherwise the repoint throws UNIQUE constraint failed
// whenever both accounts hold a matching row. Every entry below is an
// append-only-or-surrogate-keyed table, which is why the plain UPDATE is
// safe. See mergeUserInto for the tables still missing from here.
export const USER_FK_TABLES = [
  "chat_threads",
  "body_measurements",
  "sessions",
  // Issue #494 — these gained `user_id INTEGER REFERENCES users(id)`. Without
  // repointing them, the `DELETE FROM users` at the end of mergeUserInto
  // fails the FK check under `foreign_keys = ON`, which propagates out of
  // upsertUserByAppleSub and 500s the SIWA callback — locking out any user
  // whose merged-away account had ever chatted or synced.
  "chat_logs",
  "sync_logs",
  // Issue #499 — route_logs gained the same FK for the same tenant-scoping
  // reason. Append-only, keyed by its own surrogate id, so the bare repoint
  // is safe.
  "route_logs",
  // Issue #502 review — these four were previously (incorrectly) parked in
  // KNOWN_UNMERGED_USER_FK_TABLES under a blanket "user_id is in a PK/UNIQUE
  // constraint" claim that was never true for any of them: all four are
  // plain surrogate-keyed (`id`) append-only tables with no UNIQUE index
  // touching user_id, so the bare repoint below is safe. Moving
  // chat_attachments in particular fixes a live data-loss bug: its
  // `user_id INTEGER REFERENCES users(id) ON DELETE CASCADE` meant
  // mergeUserInto's trailing `DELETE FROM users` never threw for it — it
  // silently cascaded, deleting the losing account's attachments instead of
  // repointing them to the survivor.
  "workouts",
  "client_logs",
  "perf_metrics",
  "chat_attachments",
  // Issue #502 review, connection.test.ts reflection widened to enumerate by
  // `user_id` column presence rather than declared-FK alone: workout_plans
  // and server_logs carry a plain `user_id` column with NO `REFERENCES`
  // clause (connection.ts), so the old FK-only reflection couldn't see them
  // at all — mergeUserInto silently orphaned their rows on every split-brain
  // merge instead of repointing them. Neither declares an FK, so their
  // absence never caused the #504 constraint-failure symptom, but the fix is
  // the same shape: user_id sits in no PRIMARY KEY or UNIQUE index in either
  // table, so the bare repoint is unconditionally safe.
  "workout_plans",
  "server_logs",
] as const;

/**
 * Tables that only exist on some DBs, so they can't live in the static list.
 * `journal` is externally populated and absent from production entirely.
 */
export function optionalUserFkTables(db: DB): string[] {
  const tables: string[] = [];
  if (hasTable(db, "journal") && hasColumn(db, "journal", "user_id")) {
    tables.push("journal");
  }
  return tables;
}

/**
 * Tables that reference `users(id)` but are DELIBERATELY absent from
 * USER_FK_TABLES because `user_id` genuinely participates in a PRIMARY KEY
 * or UNIQUE constraint there — a bare `UPDATE ... SET user_id` would trade
 * today's FK failure for a UNIQUE constraint failure whenever both merging
 * accounts hold a matching row (e.g. the same `date` in `recovery`, or the
 * same `(user_id, provider)` in `integrations`). Merging those needs a
 * per-table conflict policy (which row wins, what happens to the loser) — a
 * design decision, not a mechanical fix. See the KNOWN GAP note on
 * mergeUserInto.
 *
 * Every member below actually satisfies that invariant (verified against the
 * live schema): `integrations` (user_id, provider), `user_settings`
 * (user_id alone), `device_tokens` (user_id, token), and `recovery` /
 * `cycles` / `sleep` / `daily_summary` (user_id, date or user_id, sleep_id).
 * A table that only *references* users(id) without user_id sitting in a
 * PK/UNIQUE index (e.g. a plain surrogate-keyed append-only table) belongs in
 * USER_FK_TABLES instead, not here — see issue #502 review, which found four
 * such tables (workouts, client_logs, perf_metrics, chat_attachments)
 * miscategorized here under this same doc comment before it was corrected.
 *
 * Exists so connection.test.ts's FK-table reflection test can tell "known,
 * deliberately unmerged" apart from "somebody forgot to list it" — the
 * latter is exactly what let #496 slip through review three times before
 * being caught.
 */
export const KNOWN_UNMERGED_USER_FK_TABLES = [
  "integrations",
  "user_settings",
  "device_tokens",
  "recovery",
  "cycles",
  "sleep",
  "daily_summary",
] as const;

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

      // Bootstrap binding. Single-user phase: user_id=1 owns all data and is
      // implicitly created by openWrite()'s INSERT OR IGNORE. On the first
      // SIWA sign-in (web OR ios) we adopt that row instead of leaving it
      // orphaned and creating a fresh user — otherwise every chat / body
      // measurement / FK pointing at user_id=1 silently disconnects from the
      // signed-in user.
      const bootstrap = db
        .prepare(
          "SELECT id, email, name, apple_sub, timezone FROM users WHERE id = 1 AND apple_sub IS NULL LIMIT 1"
        )
        .get() as User | undefined;
      if (bootstrap) {
        db.prepare(
          "UPDATE users SET apple_sub = ?, email = COALESCE(email, ?), timezone = COALESCE(timezone, ?) WHERE id = 1"
        ).run(appleSub, email ?? null, tz ?? null);
        return {
          id: 1,
          email: bootstrap.email ?? email ?? null,
          name: bootstrap.name ?? null,
          apple_sub: appleSub,
          timezone: bootstrap.timezone ?? tz ?? null,
        };
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

// null/undefined means "no opinion" — never clobber a saved TZ on later sign-ins.
function applyTzUpdate(db: DB, user: User, tz: string | null | undefined): void {
  if (tz == null) return;
  if (user.timezone === tz) return;
  db.prepare("UPDATE users SET timezone = ? WHERE id = ?").run(tz, user.id);
  user.timezone = tz;
}

/**
 * Repoint every `user_id` FK from `fromId` onto `toId`, then delete `fromId`.
 * Caller must wrap in a transaction.
 *
 * KNOWN GAP (pre-dates issue #494, deliberately not widened here): seven
 * tables reference users(id) and are still absent from this list —
 * integrations, user_settings, device_tokens, and four of the five Whoop
 * domain tables (recovery, cycles, sleep, daily_summary; workouts moved into
 * USER_FK_TABLES, see below). They can't simply be appended: `user_id` is
 * part of the PRIMARY KEY in integrations
 * (user_id, provider), user_settings (user_id), device_tokens (user_id,
 * token), recovery / cycles / daily_summary (user_id, date) and sleep
 * (user_id, sleep_id), so a bare repoint would trade today's FK failure for a
 * UNIQUE constraint failure whenever both accounts hold a matching row.
 * Merging those needs a per-table conflict policy (which row wins, and what
 * happens to the loser) — a design decision, not a mechanical fix, and out of
 * scope for a data-scoping change. (chat_attachments, client_logs,
 * perf_metrics, and workouts used to be listed here too, but issue #502
 * review found that claim false for all four — none has user_id in a
 * PK/UNIQUE index, so they're plain surrogate-keyed append-only tables and
 * were moved into USER_FK_TABLES above instead.)
 */
function mergeUserInto(db: DB, fromId: number, toId: number): void {
  const moves: Record<string, number> = {};
  for (const table of [...USER_FK_TABLES, ...optionalUserFkTables(db)]) {
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
