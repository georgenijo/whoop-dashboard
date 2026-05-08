#!/usr/bin/env -S node --experimental-strip-types --no-warnings
/**
 * One-shot data migration: collapse the legacy bootstrap user (`user_id = 1`)
 * onto the canonical SIWA user row.
 *
 * Pre-Phase-3.A:
 *   - Web requests (no Authorization header) → bootstrap user (id=1)
 *   - iOS requests (SIWA bearer) → user row with apple_sub set, often id=2
 *   Result: chat_threads.user_id = 1 for web threads, = 2 for iOS threads.
 *
 * Phase 3.A unifies both surfaces by email. After this migration runs, both
 * surfaces resolve to the SIWA-created row, and any pre-existing chat threads
 * stamped with user_id=1 are reattributed onto that same row.
 *
 * Resolution rules:
 *   - Canonical user = the row whose email matches CANONICAL_EMAIL.
 *   - If no such row exists, no-op (SIWA hasn't run yet — nothing to merge).
 *   - If the canonical row IS the bootstrap row (id=1), no-op.
 *   - Otherwise: move chat_threads.user_id from 1 → canonical.id inside a
 *     single transaction. chat_messages have no user_id column (scoped by
 *     thread_id) so they follow automatically.
 *
 * Idempotent: running twice produces zero rows moved on the second run.
 *
 * Usage (run from anywhere — script resolves `better-sqlite3` from
 * `apps/web/node_modules`):
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

// `better-sqlite3` lives in apps/web. Resolve through apps/web's require()
// so the script works from any cwd.
const here = path.dirname(fileURLToPath(import.meta.url));
const requireFromApp = createRequire(
  path.join(here, "..", "apps", "web", "package.json")
);
const Database = requireFromApp("better-sqlite3") as typeof import("better-sqlite3");

const CANONICAL_EMAIL = (
  process.env.CANONICAL_EMAIL ?? "george.nijo8@gmail.com"
).trim().toLowerCase();
const BOOTSTRAP_USER_ID = 1;

function dbPath(): string {
  if (process.env.WHOOP_DB_PATH) return process.env.WHOOP_DB_PATH;
  // Default: shared/whoop_data.db at repo root, resolved relative to this
  // script (works regardless of CWD).
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "shared", "whoop_data.db");
}

type UserRow = {
  id: number;
  email: string | null;
  apple_sub: string | null;
};

function main(): void {
  const p = dbPath();
  if (!existsSync(p)) {
    console.error(`DB not found at ${p}`);
    process.exit(1);
  }

  console.log(`[migrate] db=${p}`);
  console.log(`[migrate] canonical_email=${CANONICAL_EMAIL}`);

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

    const beforeBootstrap = db
      .prepare("SELECT COUNT(*) AS n FROM chat_threads WHERE user_id = ?")
      .get(BOOTSTRAP_USER_ID) as { n: number };
    const beforeCanonical = db
      .prepare("SELECT COUNT(*) AS n FROM chat_threads WHERE user_id = ?")
      .get(canonical.id) as { n: number };

    console.log(
      `[migrate] before: bootstrap(id=${BOOTSTRAP_USER_ID})=${beforeBootstrap.n} threads, ` +
        `canonical(id=${canonical.id})=${beforeCanonical.n} threads`
    );

    const updateThreads = db.prepare(
      "UPDATE chat_threads SET user_id = ? WHERE user_id = ?"
    );

    const merge = db.transaction(() => {
      const result = updateThreads.run(canonical.id, BOOTSTRAP_USER_ID);
      return result.changes;
    });

    const moved = merge();

    const afterBootstrap = db
      .prepare("SELECT COUNT(*) AS n FROM chat_threads WHERE user_id = ?")
      .get(BOOTSTRAP_USER_ID) as { n: number };
    const afterCanonical = db
      .prepare("SELECT COUNT(*) AS n FROM chat_threads WHERE user_id = ?")
      .get(canonical.id) as { n: number };

    console.log(
      `[migrate] moved ${moved} chat_threads from user_id=${BOOTSTRAP_USER_ID} → user_id=${canonical.id}`
    );
    console.log(
      `[migrate] after:  bootstrap(id=${BOOTSTRAP_USER_ID})=${afterBootstrap.n} threads, ` +
        `canonical(id=${canonical.id})=${afterCanonical.n} threads`
    );

    // chat_messages have no user_id column (scoped by thread_id) so no
    // separate update is needed — they ride along with the thread.
    console.log(`[migrate] done.`);
  } finally {
    db.close();
  }
}

main();
