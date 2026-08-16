#!/usr/bin/env -S node --experimental-strip-types --no-warnings
/**
 * One-shot migration: collapse the legacy bootstrap user (`user_id = 1`) onto
 * the canonical SIWA user row matched by CANONICAL_EMAIL.
 *
 * Idempotent. Single transaction.
 *
 * NOTE (issue #504): the USER_FK_TABLES snapshot below is FROZEN at the three
 * tables that existed when this one-shot ran; it is NOT the current schema and
 * must not be treated as such. Re-running it against today's DB would hit the
 * same `FOREIGN KEY constraint failed` that #504 fixed in mergeUserInto —
 * every table added since (chat_logs, sync_logs, route_logs, workouts,
 * chat_attachments, …) plus the seven tables that need the survivor-wins
 * conflict policy would still point at the collapsed user. Use
 * upsertUserByAppleSub / mergeUserInto (apps/web/src/lib/db/auth.ts) for any
 * new merge; that is the maintained path.
 *
 * Usage (run from anywhere — script resolves better-sqlite3 from
 * apps/web/node_modules):
 *   node --experimental-strip-types scripts/migrate-bootstrap-user.ts
 *
 * Override target email:
 *   CANONICAL_EMAIL=other@example.com node --experimental-strip-types ...
 *
 * Override DB path:
 *   WHOOP_DB_PATH=/path/to/whoop_data.db node --experimental-strip-types ...
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const requireFromApp = createRequire(
  path.join(here, "..", "apps", "web", "package.json")
);
const Database = requireFromApp("better-sqlite3") as typeof import("better-sqlite3");

const CANONICAL_EMAIL = (
  process.env.CANONICAL_EMAIL ?? "george.nijo8@gmail.com"
).trim().toLowerCase();
const BOOTSTRAP_USER_ID = 1;

// Frozen snapshot of the user_id FK tables as of this one-shot's run — see
// the #504 note in the header. Deliberately NOT kept in sync with
// USER_FK_TABLES in apps/web/src/lib/db/auth.ts.
const USER_FK_TABLES = ["chat_threads", "body_measurements", "sessions"] as const;

function dbPath(): string {
  if (process.env.WHOOP_DB_PATH) return process.env.WHOOP_DB_PATH;
  return path.resolve(here, "..", "shared", "whoop_data.db");
}

type UserRow = {
  id: number;
  email: string | null;
  apple_sub: string | null;
};

function tableExists(db: InstanceType<typeof Database>, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
  return !!row;
}

function countByUser(
  db: InstanceType<typeof Database>,
  table: string,
  userId: number
): number {
  if (!tableExists(db, table)) return 0;
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`)
    .get(userId) as { n: number };
  return row.n;
}

function main(): void {
  const p = dbPath();
  if (!existsSync(p)) {
    console.error(`DB not found at ${p}`);
    process.exit(1);
  }

  console.log(`[migrate] db=${p}`);
  console.log(`[migrate] canonical_email=${CANONICAL_EMAIL}`);
  console.log(`[migrate] tables=${USER_FK_TABLES.join(",")}`);

  const db = new Database(p);
  try {
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");

    const canonical = db
      .prepare(
        "SELECT id, email, apple_sub FROM users WHERE LOWER(email) = ? LIMIT 1"
      )
      .get(CANONICAL_EMAIL) as UserRow | undefined;

    if (!canonical) {
      console.log(
        `[migrate] no user row with email=${CANONICAL_EMAIL} — nothing to merge. ` +
          `SIWA likely has not run yet on this DB. No-op.`
      );
      return;
    }

    if (canonical.id === BOOTSTRAP_USER_ID) {
      console.log(
        `[migrate] canonical user IS the bootstrap user (id=${BOOTSTRAP_USER_ID}). No-op.`
      );
      return;
    }

    console.log(`[migrate] before:`);
    for (const table of USER_FK_TABLES) {
      const b = countByUser(db, table, BOOTSTRAP_USER_ID);
      const c = countByUser(db, table, canonical.id);
      console.log(`  ${table}: bootstrap=${b}, canonical=${c}`);
    }

    const merge = db.transaction(() => {
      const moves: Record<string, number> = {};
      for (const table of USER_FK_TABLES) {
        if (!tableExists(db, table)) {
          moves[table] = 0;
          continue;
        }
        const result = db
          .prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`)
          .run(canonical.id, BOOTSTRAP_USER_ID);
        moves[table] = result.changes;
      }
      return moves;
    });

    const moved = merge();

    console.log(
      `[migrate] moved per table (user_id=${BOOTSTRAP_USER_ID} → user_id=${canonical.id}):`
    );
    let total = 0;
    for (const [t, n] of Object.entries(moved)) {
      console.log(`  ${t}: ${n}`);
      total += n;
    }
    console.log(`[migrate] total rows moved: ${total}`);

    console.log(`[migrate] after:`);
    for (const table of USER_FK_TABLES) {
      const b = countByUser(db, table, BOOTSTRAP_USER_ID);
      const c = countByUser(db, table, canonical.id);
      console.log(`  ${table}: bootstrap=${b}, canonical=${c}`);
    }

    console.log(`[migrate] done.`);
  } finally {
    db.close();
  }
}

main();
