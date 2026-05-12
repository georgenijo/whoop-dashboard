// Post-Phase-D one-shot — reassign legacy uid=1 domain rows to current SIWA
// uid=2 (cross_device_user_split). Composite-PK tables (recovery, sleep,
// cycles, daily_summary): uid=2 wins on overlap (post-reconnect = fresh).
// workouts (PK=id): straight UPDATE — no overlap possible by Whoop ID.
// Then recompute daily_summary for dates that gained signals but have no
// summary row.
//
// Usage:
//   cd apps/web
//   WHOOP_DB_PATH=/path/to/whoop_data.db npx tsx scripts/migrate-uid1-to-uid2.ts            # dry-run
//   WHOOP_DB_PATH=/path/to/whoop_data.db npx tsx scripts/migrate-uid1-to-uid2.ts --commit

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

const FROM_UID = 1;
const TO_UID = 2;
const COMPOSITE_TABLES = ["recovery", "sleep", "cycles", "daily_summary"] as const;

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

  const commit = process.argv.includes("--commit");
  console.log(
    `[migrate] mode=${commit ? "COMMIT" : "DRY-RUN"} from=uid${FROM_UID} to=uid${TO_UID} db=${dbPath}`,
  );

  const { openWrite } = await import("../src/lib/db/connection");
  const { recomputeDailySummary } = await import("../src/lib/whoop/upsert");

  const db = openWrite();
  if (!db) {
    console.error("openWrite returned null — schema migration may have failed");
    return 2;
  }

  // ---- BEFORE STATE ----
  console.log(`\n=== before ===`);
  for (const t of [...COMPOSITE_TABLES, "workouts"]) {
    const a = db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).get(FROM_UID) as { n: number };
    const b = db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).get(TO_UID) as { n: number };
    console.log(`  ${t}: uid=${FROM_UID} → ${a.n}; uid=${TO_UID} → ${b.n}`);
  }

  // ---- PLAN ----
  console.log(`\n=== plan ===`);
  for (const t of COMPOSITE_TABLES) {
    const loser = db
      .prepare(
        `SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ? AND date IN (SELECT date FROM ${t} WHERE user_id = ?)`,
      )
      .get(FROM_UID, TO_UID) as { n: number };
    const move = db
      .prepare(
        `SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ? AND date NOT IN (SELECT date FROM ${t} WHERE user_id = ?)`,
      )
      .get(FROM_UID, TO_UID) as { n: number };
    console.log(
      `  ${t}: DELETE ${loser.n} loser uid=${FROM_UID} rows (date already on uid=${TO_UID}); UPDATE ${move.n} → uid=${TO_UID}`,
    );
  }
  const wTotal = db.prepare(`SELECT COUNT(*) AS n FROM workouts WHERE user_id = ?`).get(FROM_UID) as { n: number };
  console.log(`  workouts: UPDATE ${wTotal.n} → uid=${TO_UID} (PK=id, no overlap)`);

  // ---- SAMPLE migration dates ----
  const dateSample = db
    .prepare(
      `SELECT date FROM recovery WHERE user_id = ? AND date NOT IN (SELECT date FROM recovery WHERE user_id = ?) ORDER BY date ASC`,
    )
    .all(FROM_UID, TO_UID) as { date: string }[];
  if (dateSample.length > 0) {
    console.log(
      `\n=== sample recovery dates being migrated (${dateSample.length} total) ===`,
    );
    console.log(`  first 5: ${dateSample.slice(0, 5).map((r) => r.date).join(", ")}`);
    console.log(`  last 5:  ${dateSample.slice(-5).map((r) => r.date).join(", ")}`);
  }

  // ---- daily_summary gap forecast ----
  const gap = db
    .prepare(
      `
      SELECT COUNT(DISTINCT date) AS n FROM (
        SELECT date FROM recovery WHERE user_id IN (?, ?)
        UNION
        SELECT date FROM sleep    WHERE user_id IN (?, ?)
        UNION
        SELECT date FROM cycles   WHERE user_id IN (?, ?)
      ) WHERE date NOT IN (
        SELECT date FROM daily_summary WHERE user_id IN (?, ?)
      )
      `,
    )
    .get(FROM_UID, TO_UID, FROM_UID, TO_UID, FROM_UID, TO_UID, FROM_UID, TO_UID) as { n: number };
  console.log(
    `\n=== daily_summary recompute forecast ===\n  ${gap.n} dates have recovery/sleep/cycles but no daily_summary anywhere`,
  );

  if (!commit) {
    console.log(`\n[migrate] DRY-RUN — no writes performed. Re-run with --commit to apply.`);
    db.close();
    return 0;
  }

  // ---- COMMIT ----
  console.log(`\n[migrate] COMMIT — applying`);
  const tx = db.transaction(() => {
    for (const t of COMPOSITE_TABLES) {
      const delInfo = db
        .prepare(
          `DELETE FROM ${t} WHERE user_id = ? AND date IN (SELECT date FROM ${t} WHERE user_id = ?)`,
        )
        .run(FROM_UID, TO_UID);
      const updInfo = db
        .prepare(`UPDATE ${t} SET user_id = ? WHERE user_id = ?`)
        .run(TO_UID, FROM_UID);
      console.log(
        `  ${t}: deleted ${delInfo.changes} losers; reassigned ${updInfo.changes} → uid=${TO_UID}`,
      );
    }
    const wInfo = db
      .prepare(`UPDATE workouts SET user_id = ? WHERE user_id = ?`)
      .run(TO_UID, FROM_UID);
    console.log(`  workouts: reassigned ${wInfo.changes} → uid=${TO_UID}`);
  });
  tx();

  // ---- daily_summary recompute ----
  const gapDates = db
    .prepare(
      `
      SELECT date FROM (
        SELECT date FROM recovery WHERE user_id = ?
        UNION
        SELECT date FROM sleep    WHERE user_id = ?
        UNION
        SELECT date FROM cycles   WHERE user_id = ?
      ) WHERE date NOT IN (SELECT date FROM daily_summary WHERE user_id = ?)
      ORDER BY date ASC
      `,
    )
    .all(TO_UID, TO_UID, TO_UID, TO_UID) as { date: string }[];

  db.close();

  console.log(`\n[migrate] recomputing daily_summary for ${gapDates.length} dates`);
  let ok = 0;
  let failed = 0;
  for (const { date } of gapDates) {
    try {
      if (recomputeDailySummary(date, TO_UID)) ok += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      console.warn(`  recompute ${date}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`  ok=${ok} failed=${failed}`);

  // ---- AFTER STATE ----
  const db2 = openWrite();
  if (db2) {
    console.log(`\n=== after ===`);
    for (const t of [...COMPOSITE_TABLES, "workouts"]) {
      const a = db2.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).get(FROM_UID) as { n: number };
      const b = db2.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).get(TO_UID) as { n: number };
      console.log(`  ${t}: uid=${FROM_UID} → ${a.n}; uid=${TO_UID} → ${b.n}`);
    }
    db2.close();
  }

  console.log(`\n[migrate] done`);
  return failed > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("migrate crashed:", err);
    process.exit(1);
  });
