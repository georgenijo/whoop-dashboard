// Phase D one-shot — backfill `integrations.provider_user_id` for any
// existing Whoop rows that pre-date Phase D. Idempotent: rows where the
// column is already populated are skipped.
//
// For each row WHERE provider='whoop' AND provider_user_id IS NULL:
//   - Fetch the Whoop user profile via the existing valid token (refreshing
//     if necessary via getValidAccessToken inside whoopGet).
//   - Persist the remote user_id via setProviderUserId.
//
// Failures per row are logged but don't halt the script — a single bad
// integration (revoked tokens) shouldn't block backfilling the rest. The
// next runWhoopSync for that user will retry via the lazy backfill in
// sync.ts.
//
// Usage:
//   cd apps/web
//   VAULT_KEY=... WHOOP_CLIENT_ID=... WHOOP_CLIENT_SECRET=... \
//     WHOOP_DB_PATH=/path/to/whoop_data.db \
//     npx tsx scripts/backfill-whoop-provider-user-id.ts

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

async function main(): Promise<number> {
  if (!process.env.VAULT_KEY) {
    console.error(
      "VAULT_KEY is not set. Required to decrypt tokens for the profile fetch.",
    );
    return 2;
  }
  if (!process.env.WHOOP_CLIENT_ID || !process.env.WHOOP_CLIENT_SECRET) {
    console.error(
      "WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET must be set — needed if a token refresh fires mid-backfill.",
    );
    return 2;
  }
  const dbPath = process.env.WHOOP_DB_PATH;
  if (!dbPath) {
    console.error(
      "WHOOP_DB_PATH is not set. Point at the SQLite file (shared/whoop_data.db in prod).",
    );
    return 2;
  }
  if (!existsSync(dbPath)) {
    console.error(`WHOOP_DB_PATH does not exist: ${dbPath}`);
    return 2;
  }

  // Side-effect: lazy ALTER inside openWrite() ensures provider_user_id
  // column + index exist before the SELECT runs.
  const { openWrite } = await import("../src/lib/db/connection");
  const { setProviderUserId } = await import("../src/lib/db/integrations");
  const { getWhoopProfile } = await import("../src/lib/whoop/client");

  // Pull the list of rows needing backfill via a direct read open. Bypasses
  // the encrypted helpers because we don't need the decrypted tokens here —
  // getWhoopProfile() → whoopGet() → getValidAccessToken() takes care of
  // decryption + refresh for us.
  const db = openWrite();
  if (!db) {
    console.error("[backfill] openWrite returned null — DB unreadable");
    return 2;
  }
  let rows: { user_id: number }[];
  try {
    rows = db
      .prepare(
        "SELECT user_id FROM integrations " +
          "WHERE provider = 'whoop' AND provider_user_id IS NULL",
      )
      .all() as { user_id: number }[];
  } finally {
    db.close();
  }

  console.log(`[backfill] ${rows.length} row(s) need provider_user_id`);
  if (rows.length === 0) return 0;

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const profile = await getWhoopProfile({ userId: row.user_id });
      if (profile?.user_id == null) {
        console.warn(
          `[backfill] user_id=${row.user_id}: profile returned no user_id`,
        );
        failed += 1;
        continue;
      }
      setProviderUserId(row.user_id, "whoop", String(profile.user_id));
      console.log(
        `[backfill] user_id=${row.user_id} → provider_user_id=${profile.user_id}`,
      );
      ok += 1;
    } catch (err) {
      console.warn(
        `[backfill] user_id=${row.user_id} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      failed += 1;
    }
  }

  console.log(`[backfill] done — ${ok} ok, ${failed} failed`);
  return failed > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("backfill crashed:", err);
    process.exit(1);
  });
