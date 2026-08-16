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
// safe. Tables where `user_id` IS part of a PRIMARY KEY or UNIQUE index live
// in USER_FK_CONFLICT_TABLES below and are merged survivor-wins instead
// (issue #504); nothing user_id-bearing may be left out of both lists.
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
 * Tables where `user_id` genuinely participates in a PRIMARY KEY or UNIQUE
 * index, so the bare `UPDATE ... SET user_id` used for USER_FK_TABLES would
 * throw `UNIQUE constraint failed` whenever both merging accounts hold a
 * matching row (the same `date` in `recovery`, the same `(user_id, provider)`
 * in `integrations`, and so on).
 *
 * Verified against the live schema: `integrations` PK (user_id, provider),
 * `user_settings` PK (user_id), `device_tokens` PK (user_id, token),
 * `recovery` / `cycles` / `daily_summary` PK (user_id, date), `sleep` PK
 * (user_id, sleep_id). The keys are deliberately NOT uniform — see the DB
 * layer section of CLAUDE.md — which is why mergeConflictTable derives the
 * collision key from `PRAGMA table_info` / `index_list` at run time instead
 * of hardcoding `(user_id, date)`.
 *
 * CONFLICT POLICY (issue #504, decided by the repo owner): **SURVIVOR WINS**.
 * Loser rows that do not collide are repointed like any other table; loser
 * rows that would collide with a row already owned by the surviving account
 * are deleted, and the per-table drop count is logged. Rationale: it is
 * deterministic, it never mutates data belonging to the account that is
 * staying, and in practice both rows derive from the same Whoop account, so
 * they are near-identical.
 *
 * Leaving these out of the merge entirely (which is what happened before
 * #504) does not dodge the conflict question — it converts a UNIQUE collision
 * into a FOREIGN KEY failure on the trailing `DELETE FROM users`, which is
 * strictly worse: it takes Sign in with Apple down instead of losing one
 * duplicate row.
 */
export const USER_FK_CONFLICT_TABLES = [
  "integrations",
  "user_settings",
  "device_tokens",
  "recovery",
  "cycles",
  "sleep",
  "daily_summary",
] as const;

/**
 * Tables that reference `users(id)` (or carry a `user_id` column) and are
 * NOT merged at all — neither repointed via USER_FK_TABLES nor
 * conflict-merged via USER_FK_CONFLICT_TABLES.
 *
 * **This list must stay empty.** Before issue #504 it held the seven tables
 * now in USER_FK_CONFLICT_TABLES, and that was not a safe parking spot: a
 * table listed here still holds rows pointing at the losing account when
 * mergeUserInto runs `DELETE FROM users`, so under `foreign_keys = ON` the
 * merge either throws `FOREIGN KEY constraint failed` (500 on the SIWA
 * callback — a hard sign-in lockout) or, if the FK declares ON DELETE
 * CASCADE, silently destroys the rows. Both were live bugs.
 *
 * The entry exists only as an explicit escape hatch for a future table that
 * genuinely cannot be merged either way. Adding one is a policy decision:
 * connection.test.ts asserts this list is empty, and its behavioural merge
 * test would have to be taught to expect the resulting data loss.
 */
export const KNOWN_UNMERGED_USER_FK_TABLES: readonly string[] = [];

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
 * Every uniqueness constraint on `table` whose column set contains `user_id`,
 * read from the live schema rather than hardcoded.
 *
 * These are exactly the constraints a `UPDATE ... SET user_id` repoint can
 * violate: changing `user_id` cannot newly collide on an index that does not
 * mention `user_id` (none of the other columns move). The returned column
 * lists are the collision keys used by mergeConflictTable.
 *
 * Reflected, not hardcoded, for two reasons: the domain tables' primary keys
 * are deliberately non-uniform (`(user_id, date)` for recovery / cycles /
 * daily_summary but `(user_id, sleep_id)` for sleep — assuming otherwise has
 * broken this repo's test suite before), and a future ALTER that adds or
 * widens a UNIQUE index is picked up automatically instead of silently
 * invalidating a copied-out list.
 */
export function userIdUniqueKeys(db: DB, table: string): string[][] {
  const keys: string[][] = [];

  // A composite PRIMARY KEY shows up in index_list as sqlite_autoindex_*, but
  // an INTEGER PRIMARY KEY (user_settings.user_id) is a rowid alias with no
  // index at all — so the PK has to be read from table_info as well.
  const info = db.prepare(`PRAGMA table_info("${table}")`).all() as {
    name: string;
    pk: number;
  }[];
  const pk = info
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
  if (pk.includes("user_id")) keys.push(pk);

  const indexes = db.prepare(`PRAGMA index_list("${table}")`).all() as {
    name: string;
    unique: number;
    partial: number;
  }[];
  for (const idx of indexes) {
    if (!idx.unique) continue;
    const cols = (
      db.prepare(`PRAGMA index_info("${idx.name}")`).all() as {
        name: string | null;
      }[]
    ).map((c) => c.name);
    // An expression index has a NULL column name — there is nothing to
    // compare generically, so leave it to SQLite to reject the repoint rather
    // than silently dropping rows on a key we can't evaluate.
    if (cols.some((c) => c == null)) continue;
    if (!cols.includes("user_id")) continue;
    // A partial unique index constrains only the rows matching its WHERE
    // clause, which this key-set model cannot express: treating it as total
    // would delete loser rows that were never going to collide — silent data
    // loss, the exact failure mode #504 exists to remove. The schema has none
    // today, so fail loudly if one ever appears instead of guessing.
    if (idx.partial) {
      throw new Error(
        `mergeUserInto: ${table}.${idx.name} is a PARTIAL unique index covering user_id; ` +
          `the survivor-wins conflict policy needs an explicit predicate for it`,
      );
    }
    keys.push(cols as string[]);
  }

  const seen = new Set<string>();
  return keys.filter((k) => {
    const sig = k.join(" ");
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

/**
 * Survivor-wins merge for one USER_FK_CONFLICT_TABLES table.
 *
 * Delete-then-update, in that order: drop the loser rows that would collide
 * with a row the survivor already owns, then repoint everything that is left.
 * The reverse (`UPDATE` first) throws on the first collision, and
 * `INSERT OR REPLACE` is NOT a usable shortcut here — REPLACE resolves a
 * conflict by *deleting the survivor's row* and inserting the loser's, which
 * inverts the policy, and its delete fires ON DELETE CASCADE actions (the
 * exact mechanism behind the silent `chat_attachments` data loss in #504).
 * A plain DELETE on these seven tables cascades nowhere: nothing in the
 * schema references them.
 *
 * After the collision deletes, the trailing UPDATE cannot collide: two
 * surviving loser rows would have to share a collision key, which they
 * already can't (they coexist under the same `user_id` today).
 *
 * @returns rows dropped (loser lost the collision) and rows moved.
 */
function mergeConflictTable(
  db: DB,
  table: string,
  fromId: number,
  toId: number,
): { dropped: number; moved: number } {
  let dropped = 0;
  for (const key of userIdUniqueKeys(db, table)) {
    const others = key.filter((c) => c !== "user_id").map((c) => `"${c}"`);
    // `user_settings` keys on user_id alone, so there is no residual column to
    // match on — any row the survivor already owns is the collision.
    const sql = others.length
      ? `DELETE FROM "${table}" WHERE user_id = ? AND (${others.join(", ")}) IN ` +
        `(SELECT ${others.join(", ")} FROM "${table}" WHERE user_id = ?)`
      : `DELETE FROM "${table}" WHERE user_id = ? AND EXISTS ` +
        `(SELECT 1 FROM "${table}" WHERE user_id = ?)`;
    dropped += db.prepare(sql).run(fromId, toId).changes;
  }
  const moved = db
    .prepare(`UPDATE "${table}" SET user_id = ? WHERE user_id = ?`)
    .run(toId, fromId).changes;
  return { dropped, moved };
}

/**
 * Repoint every `user_id` row from `fromId` onto `toId`, then delete `fromId`.
 * Caller must wrap in a transaction — issue #504 requires it: a partial merge
 * that dropped conflicting rows and then failed must not be committable.
 *
 * Two mechanisms, because the schema has two shapes:
 *
 *  - USER_FK_TABLES — surrogate-keyed, `user_id` in no PK/UNIQUE index, so a
 *    bare `UPDATE ... SET user_id` can never collide.
 *  - USER_FK_CONFLICT_TABLES — `user_id` is in the PK or a UNIQUE index, so
 *    the repoint is survivor-wins (see mergeConflictTable).
 *
 * Every table that references users(id), or merely carries a `user_id`
 * column, must be in one list or the other. Anything left out still points at
 * `fromId` when the trailing `DELETE FROM users` runs, and under
 * `foreign_keys = ON` (connection.ts) that either throws FOREIGN KEY
 * constraint failed — 500ing the Sign in with Apple callback — or, for an FK
 * declaring ON DELETE CASCADE, silently destroys the rows. connection.test.ts
 * enforces the completeness of the two lists by running a real merge.
 */
function mergeUserInto(db: DB, fromId: number, toId: number): void {
  const moves: Record<string, number> = {};
  const drops: Record<string, number> = {};

  for (const table of [...USER_FK_TABLES, ...optionalUserFkTables(db)]) {
    const result = db
      .prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`)
      .run(toId, fromId);
    moves[table] = result.changes;
  }

  for (const table of USER_FK_CONFLICT_TABLES) {
    const { dropped, moved } = mergeConflictTable(db, table, fromId, toId);
    moves[table] = moved;
    drops[table] = dropped;
  }

  db.prepare("DELETE FROM users WHERE id = ?").run(fromId);

  const droppedEntries = Object.entries(drops).filter(([, n]) => n > 0);
  const totalDropped = droppedEntries.reduce((sum, [, n]) => sum + n, 0);
  // Drops are data loss, so they get their own labelled segment of the line
  // (and warn level when non-zero) rather than blending into the move counts —
  // a silent drop is the exact failure mode issue #504 is about.
  const line =
    `[upsertUserByAppleSub] merged user id=${fromId} → id=${toId}; moved: ` +
    Object.entries(moves)
      .map(([t, n]) => `${t}=${n}`)
      .join(", ") +
    `; dropped(survivor-wins, total=${totalDropped}): ` +
    (droppedEntries.length
      ? droppedEntries.map(([t, n]) => `${t}=${n}`).join(", ")
      : "none");
  if (totalDropped > 0) console.warn(line);
  else console.log(line);
}
