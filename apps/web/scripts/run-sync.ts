// One-shot manual Whoop sync runner — drives `runWhoopSync` outside the Next.js
// runtime so the local whoop_data.db can be backfilled from the Whoop cloud
// without the dev server / an authenticated browser session.
//
// The `/api/sync` route enforces a 5-min cooldown + a 7-day window; this bypasses
// both (calls runWhoopSync directly) so a wider catch-up window can be requested.
//
// Usage:
//   cd apps/web
//   WHOOP_DB_PATH=/abs/path/whoop_data.db \
//     node --env-file=.env --import tsx scripts/run-sync.ts [--user N] [--days D]
//
// Env required (all in apps/web/.env except WHOOP_DB_PATH):
//   WHOOP_DB_PATH, WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_REDIRECT_URI, VAULT_KEY

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

function argVal(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

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
  const userId = argVal("--user", 2);
  const days = argVal("--days", 35);

  console.log(`[run-sync] user=${userId} days=${days} db=${dbPath}`);

  const { runWhoopSync } = await import("../src/lib/sync");

  const result = await runWhoopSync({
    userId,
    days,
    onProgress: (e) => console.log(`[run-sync] stage=${e.stage}`),
  });

  if (!result.success) {
    console.error(`[run-sync] FAILED: ${result.error ?? "unknown"}`);
    return 1;
  }
  console.log("[run-sync] OK", JSON.stringify({
    partial: result.partial ?? false,
    fetched: result.fetched_counts,
    inserted: result.rows_inserted,
    latest_recovery: result.latest_recovery_date,
    latest_sleep: result.latest_sleep_date,
    latest_strain: result.latest_strain_date,
  }, null, 2));
  return 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error("[run-sync] threw:", err);
  process.exit(1);
});
