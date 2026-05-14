// Issue #345 one-shot — re-file historical workout rows under the owner's
// IANA timezone instead of UTC. Pre-fix code in apps/web/src/lib/whoop/upsert.ts
// computed `workouts.date` via `new Date(iso).toISOString().slice(0, 10)`,
// silently dropping the user's tz. Evening workouts in west-of-UTC zones
// landed on the wrong calendar day. This script re-parses `raw.start` using
// the owner's tz from user_settings.tz and rewrites `workouts.date` if it
// drifts, then recomputes daily_summary for every affected date (old + new).
//
// Idempotent: rows whose recomputed date matches the stored date are skipped.
// Users with NULL tz are skipped — we don't guess.
//
// Scope: workouts only. PK is `id` (TEXT) so UPDATE-in-place is safe. recovery,
// cycles, sleep, daily_summary have composite (user_id, date) PKs and require
// collision handling that's out of scope; their last-7d rows self-heal on the
// next sync (INSERT OR REPLACE on the new local date), older rows stay stale.
//
// Recovery: if this script crashes between the workouts UPDATE and the
// daily_summary recompute loop, rerun is a no-op for the UPDATEs (workouts
// match the new date) and the recomputes won't re-queue. Operator should
// trigger /api/sync for the affected user_id to force a daily_summary
// rebuild over the last-7d window.
//
// Usage:
//   cd apps/web
//   WHOOP_DB_PATH=/path/to/whoop_data.db npx tsx scripts/backfill-345-workout-dates.ts            # dry-run
//   WHOOP_DB_PATH=/path/to/whoop_data.db npx tsx scripts/backfill-345-workout-dates.ts --dry      # explicit dry-run
//   WHOOP_DB_PATH=/path/to/whoop_data.db npx tsx scripts/backfill-345-workout-dates.ts --commit   # apply

// Script runs outside the Next.js runtime; pre-seed the `server-only` cache
// so importing modules that mark themselves `server-only` doesn't throw.
import { createRequire } from "node:module";
const requireFromHere = createRequire(import.meta.url);
const serverOnlyPath = requireFromHere.resolve("server-only");
requireFromHere.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
  parent: null,
  require: requireFromHere,
} as unknown as NodeJS.Module;

import { existsSync } from "node:fs";

type WorkoutRow = { id: string; raw: string; date: string };
type TzRow = { user_id: number; tz: string };

async function main(): Promise<number> {
  const dbPath = process.env.WHOOP_DB_PATH;
  if (!dbPath) {
    console.error("WHOOP_DB_PATH not set");
    return 2;
  }
  if (!existsSync(dbPath)) {
    console.error(`WHOOP_DB_PATH does not exist: ${dbPath}`);
    return 2;
  }

  // Default is dry-run. `--commit` flips to write mode. `--dry` is also
  // accepted for explicitness.
  const commit = process.argv.includes("--commit");
  const explicitDry = process.argv.includes("--dry");
  if (commit && explicitDry) {
    console.error("[backfill-345] --commit and --dry are mutually exclusive");
    return 2;
  }
  console.log(
    `[backfill-345] mode=${commit ? "COMMIT" : "DRY-RUN"} db=${dbPath}`,
  );

  const { openWrite } = await import("../src/lib/db/connection");
  const { parseDate, recomputeDailySummary } = await import(
    "../src/lib/whoop/upsert"
  );

  const db = openWrite();
  if (!db) {
    console.error("[backfill-345] openWrite returned null");
    return 2;
  }

  try {
    // Pull every user that has a tz set. NULL-tz users are skipped because
    // we don't have ground truth to re-file against — leaving their dates
    // as-is is strictly safer than guessing UTC (today's behavior is
    // already UTC-derived).
    const tzRows = db
      .prepare(
        "SELECT user_id, tz FROM user_settings WHERE tz IS NOT NULL AND tz != ''",
      )
      .all() as TzRow[];

    console.log(`[backfill-345] ${tzRows.length} user(s) with tz set`);

    let totalRewritten = 0;
    let totalUnchanged = 0;
    let totalSkipped = 0;
    // (userId, date) pairs that need a daily_summary recompute after the
    // workouts UPDATEs commit.
    const recomputes = new Map<number, Set<string>>();

    const selectWorkouts = db.prepare(
      "SELECT id, raw, date FROM workouts WHERE user_id = ?",
    );
    const updateWorkout = db.prepare(
      "UPDATE workouts SET date = ? WHERE id = ? AND user_id = ?",
    );

    // Single transaction across all users — keeps the write window short and
    // gives us atomic rollback if anything throws. recomputeDailySummary
    // runs OUTSIDE this transaction (it opens its own connection).
    const tx = db.transaction(() => {
      for (const { user_id: userId, tz } of tzRows) {
        const rows = selectWorkouts.all(userId) as WorkoutRow[];
        let rewritten = 0;
        let unchanged = 0;
        let skipped = 0;

        for (const row of rows) {
          let parsedRaw: { start?: unknown };
          try {
            parsedRaw = JSON.parse(row.raw);
          } catch {
            skipped += 1;
            continue;
          }
          const start = parsedRaw.start;
          if (typeof start !== "string" || start.length === 0) {
            skipped += 1;
            continue;
          }
          let newDate: string;
          try {
            newDate = parseDate(start, tz);
          } catch (err) {
            console.warn(
              `[backfill-345] user_id=${userId} id=${row.id} parseDate(${start}, ${tz}) threw: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
            skipped += 1;
            continue;
          }

          if (newDate === row.date) {
            unchanged += 1;
            continue;
          }

          // Schedule daily_summary recompute for BOTH dates — the old one
          // loses a workout, the new one gains one.
          const set = recomputes.get(userId) ?? new Set<string>();
          set.add(row.date);
          set.add(newDate);
          recomputes.set(userId, set);

          if (commit) {
            updateWorkout.run(newDate, row.id, userId);
          } else {
            console.log(
              `[backfill-345] (dry) user_id=${userId} id=${row.id} ${row.date} → ${newDate}`,
            );
          }
          rewritten += 1;
        }

        console.log(
          `[backfill-345] user_id=${userId} tz=${tz}: ${rewritten} rewritten, ${unchanged} unchanged, ${skipped} skipped`,
        );
        totalRewritten += rewritten;
        totalUnchanged += unchanged;
        totalSkipped += skipped;
      }
    });
    tx();

    console.log(
      `\n[backfill-345] totals: ${totalRewritten} rewritten, ${totalUnchanged} unchanged, ${totalSkipped} skipped`,
    );

    if (!commit) {
      console.log(
        `[backfill-345] DRY-RUN — no writes performed. Re-run with --commit to apply.`,
      );
      return 0;
    }

    // ---- daily_summary recompute ----
    let recomputeCount = 0;
    for (const [userId, dates] of recomputes) {
      for (const date of dates) {
        recomputeDailySummary(date, userId);
        recomputeCount += 1;
      }
    }
    console.log(
      `[backfill-345] daily_summary recomputed for ${recomputeCount} (user_id, date) pair(s)`,
    );

    return 0;
  } finally {
    db.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[backfill-345] crashed:", err);
    process.exit(1);
  });
