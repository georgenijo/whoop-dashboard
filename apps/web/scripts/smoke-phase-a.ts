// Phase A smoke test — exercises the libsodium-compatible vault, the
// integrations + user_settings encryption boundaries, and the helper
// round-trip semantics. Run against a snapshot DB (via whoop-dev or
// WHOOP_DB_PATH directly):
//
//   cd apps/web
//   VAULT_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
//   WHOOP_DB_PATH=/tmp/some-snapshot.db \
//     npx tsx scripts/smoke-phase-a.ts
//
// The script never mutates production data: it uses a unique provider
// suffix and deletes its rows after every block. Failures exit non-zero
// so this is usable in CI later.

// The lib files we import declare `import "server-only"`. Outside Next that
// import throws unconditionally. Pre-populate require.cache with a stub
// before any dynamic import — same trick the vitest suite plays via
// `vi.mock("server-only", () => ({}))`.
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

import { existsSync, realpathSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

const TEST_PROVIDER = `phase-a-smoke-${Date.now()}`;
const USER_ID = 1;

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  const suffix = detail ? `  (${detail})` : "";
  console.log(`[${tag}] ${name}${suffix}`);
}

async function main(): Promise<number> {
  // Friendly preflight before any imports — failing fast here is clearer
  // than letting Better-SQLite3 throw an ENOENT deep inside helper code.
  if (!process.env.VAULT_KEY) {
    console.error(
      "VAULT_KEY is not set. Generate one with `openssl rand -base64 32`."
    );
    return 2;
  }
  const dbPath = process.env.WHOOP_DB_PATH;
  if (!dbPath) {
    console.error(
      "WHOOP_DB_PATH is not set. Point it at a snapshot DB (whoop-dev's --db-path output)."
    );
    return 2;
  }
  if (!existsSync(dbPath)) {
    console.error(`WHOOP_DB_PATH does not exist: ${dbPath}`);
    return 2;
  }
  // Refuse to run against a non-snapshot DB unless the caller explicitly opts in.
  // The cleanup path re-encrypts the existing anthropic_key with the smoke run's
  // random VAULT_KEY, so pointing at shared/whoop_data.db would corrupt the row.
  // /tmp/ matches the whoop-dev snapshot path; --allow-non-snapshot escapes the gate.
  const allowNonSnapshot = process.argv.includes("--allow-non-snapshot");
  const resolvedDbPath = realpathSync(resolvePath(dbPath));
  if (!allowNonSnapshot && !resolvedDbPath.startsWith("/tmp/") && !resolvedDbPath.startsWith("/private/tmp/")) {
    console.error(
      `Refusing to run against non-snapshot DB: ${resolvedDbPath}\n` +
        "Use the whoop-dev skill to spin up a /tmp snapshot, or pass --allow-non-snapshot to override."
    );
    return 2;
  }
  console.log(`smoke-phase-a: db=${dbPath}`);
  console.log(`smoke-phase-a: cwd=${process.cwd()}`);
  console.log(
    `smoke-phase-a: provider=${TEST_PROVIDER} (sentinel — safe to leave behind on failure)`
  );

  const vault = await import("../src/lib/crypto/vault");
  const integrations = await import("../src/lib/db/integrations");
  const userSettings = await import("../src/lib/db/user_settings");

  // ---------------- vault module ----------------
  try {
    const blob = vault.encrypt("hello world");
    const plain = vault.decrypt(blob);
    record("vault.encrypt → vault.decrypt round-trips ASCII", plain === "hello world");
  } catch (err) {
    record("vault.encrypt → vault.decrypt round-trips ASCII", false, String(err));
  }

  try {
    const unicode = "おはよう 🌅 — naïve façade";
    const blob = vault.encrypt(unicode);
    const plain = vault.decrypt(blob);
    record("vault round-trips unicode + emoji", plain === unicode);
  } catch (err) {
    record("vault round-trips unicode + emoji", false, String(err));
  }

  try {
    const blob = vault.encrypt("tamper me");
    const buf = Buffer.from(blob, "base64");
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString("base64");
    let threw = false;
    try {
      vault.decrypt(tampered);
    } catch (err) {
      threw = err instanceof vault.VaultDecryptError;
    }
    record("vault.decrypt throws VaultDecryptError on tampered ciphertext", threw);
  } catch (err) {
    record(
      "vault.decrypt throws VaultDecryptError on tampered ciphertext",
      false,
      String(err)
    );
  }

  // VAULT_KEY missing → encrypt/decrypt/assert throw.
  try {
    const saved = process.env.VAULT_KEY;
    delete process.env.VAULT_KEY;
    let encryptThrew = false;
    let assertThrew = false;
    try {
      vault.encrypt("x");
    } catch (err) {
      encryptThrew = err instanceof vault.VaultMissingKeyError;
    }
    try {
      vault.assertVaultKeyConfigured();
    } catch (err) {
      assertThrew = err instanceof vault.VaultMissingKeyError;
    }
    process.env.VAULT_KEY = saved;
    record("vault.encrypt throws when VAULT_KEY is unset", encryptThrew);
    record(
      "vault.assertVaultKeyConfigured throws when VAULT_KEY is unset",
      assertThrew
    );
  } catch (err) {
    record("vault missing-key behaviour", false, String(err));
  }

  // Wrong-length key.
  try {
    const saved = process.env.VAULT_KEY;
    process.env.VAULT_KEY = Buffer.from("too-short").toString("base64");
    let threw = false;
    try {
      vault.assertVaultKeyConfigured();
    } catch (err) {
      threw = err instanceof vault.VaultMissingKeyError;
    }
    process.env.VAULT_KEY = saved;
    record(
      "vault.assertVaultKeyConfigured rejects wrong-length keys",
      threw
    );
  } catch (err) {
    record("vault wrong-length-key behaviour", false, String(err));
  }

  // ---------------- integrations helpers ----------------
  const accessPlain = `access-${TEST_PROVIDER}`;
  const refreshPlain = `refresh-${TEST_PROVIDER}`;
  try {
    integrations.upsertIntegration({
      user_id: USER_ID,
      provider: TEST_PROVIDER,
      access_token: accessPlain,
      refresh_token: refreshPlain,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      scope: "offline read:recovery",
      token_type: "bearer",
    });
    const got = integrations.getIntegration(USER_ID, TEST_PROVIDER);
    record(
      "integrations: upsert → get round-trips plaintext access/refresh",
      got?.access_token === accessPlain && got?.refresh_token === refreshPlain
    );
  } catch (err) {
    record(
      "integrations: upsert → get round-trips plaintext access/refresh",
      false,
      String(err)
    );
  }

  // Idempotency.
  try {
    integrations.upsertIntegration({
      user_id: USER_ID,
      provider: TEST_PROVIDER,
      access_token: `${accessPlain}-v2`,
      refresh_token: `${refreshPlain}-v2`,
      expires_at: new Date(Date.now() + 7200_000).toISOString(),
    });
    const got = integrations.getIntegration(USER_ID, TEST_PROVIDER);
    record(
      "integrations: upsert is idempotent (second write replaces row)",
      got?.access_token === `${accessPlain}-v2`
    );
  } catch (err) {
    record("integrations: upsert is idempotent", false, String(err));
  }

  // Missing row → null (no throw).
  try {
    const miss = integrations.getIntegration(
      USER_ID,
      `${TEST_PROVIDER}-does-not-exist`
    );
    record("integrations: getIntegration returns null for missing row", miss === null);
  } catch (err) {
    record(
      "integrations: getIntegration returns null for missing row",
      false,
      String(err)
    );
  }

  // updated_at advances. Sleep a touch since updated_at is ISO ms.
  try {
    const before = integrations.getIntegration(USER_ID, TEST_PROVIDER)?.updated_at;
    await new Promise((r) => setTimeout(r, 10));
    integrations.upsertIntegration({
      user_id: USER_ID,
      provider: TEST_PROVIDER,
      access_token: `${accessPlain}-v3`,
      refresh_token: `${refreshPlain}-v3`,
      expires_at: new Date(Date.now() + 7200_000).toISOString(),
    });
    const after = integrations.getIntegration(USER_ID, TEST_PROVIDER)?.updated_at;
    record(
      "integrations: updated_at advances on upsert",
      !!before && !!after && after > before
    );
  } catch (err) {
    record("integrations: updated_at advances on upsert", false, String(err));
  }

  // Clean up integrations row.
  try {
    const deleted = integrations.deleteIntegration(USER_ID, TEST_PROVIDER);
    record("integrations: deleteIntegration removes the row", deleted === 1);
  } catch (err) {
    record("integrations: deleteIntegration removes the row", false, String(err));
  }

  // ---------------- user_settings helpers ----------------
  // Snapshot the user's existing settings so we can restore them, since the
  // table is a single row per user and we don't want to clobber a prod row.
  let snapshot: Awaited<ReturnType<typeof userSettings.getUserSettings>> = null;
  try {
    snapshot = userSettings.getUserSettings(USER_ID);
  } catch (err) {
    record("user_settings: read snapshot before mutating", false, String(err));
  }

  try {
    userSettings.upsertUserSettings({
      user_id: USER_ID,
      anthropic_key: "sk-ant-smoke-test",
      model_pref: "claude-sonnet-4-6",
      timezone: "America/New_York",
      monthly_token_cap: 5_000_000,
    });
    const got = userSettings.getUserSettings(USER_ID);
    record(
      "user_settings: upsert → get round-trips anthropic_key + plaintext columns",
      got?.anthropic_key === "sk-ant-smoke-test" &&
        got?.model_pref === "claude-sonnet-4-6" &&
        got?.timezone === "America/New_York" &&
        got?.monthly_token_cap === 5_000_000
    );
  } catch (err) {
    record("user_settings: upsert → get round-trip", false, String(err));
  }

  // Partial update — undefined fields stay put.
  try {
    userSettings.upsertUserSettings({ user_id: USER_ID, model_pref: "claude-haiku-4-5" });
    const got = userSettings.getUserSettings(USER_ID);
    record(
      "user_settings: undefined fields preserve existing values",
      got?.anthropic_key === "sk-ant-smoke-test" &&
        got?.model_pref === "claude-haiku-4-5" &&
        got?.timezone === "America/New_York"
    );
  } catch (err) {
    record(
      "user_settings: undefined fields preserve existing values",
      false,
      String(err)
    );
  }

  // Explicit null clears the encrypted column.
  try {
    userSettings.upsertUserSettings({ user_id: USER_ID, anthropic_key: null });
    const got = userSettings.getUserSettings(USER_ID);
    record(
      "user_settings: anthropic_key=null clears the encrypted column",
      got?.anthropic_key === null && got?.model_pref === "claude-haiku-4-5"
    );
  } catch (err) {
    record(
      "user_settings: anthropic_key=null clears the encrypted column",
      false,
      String(err)
    );
  }

  // updated_at advances.
  try {
    const before = userSettings.getUserSettings(USER_ID)?.updated_at;
    await new Promise((r) => setTimeout(r, 10));
    userSettings.upsertUserSettings({ user_id: USER_ID, model_pref: "claude-sonnet-4-6" });
    const after = userSettings.getUserSettings(USER_ID)?.updated_at;
    record(
      "user_settings: updated_at advances on upsert",
      !!before && !!after && after > before
    );
  } catch (err) {
    record("user_settings: updated_at advances on upsert", false, String(err));
  }

  // Missing row → null.
  try {
    const got = userSettings.getUserSettings(999_999);
    record(
      "user_settings: getUserSettings returns null for missing row",
      got === null
    );
  } catch (err) {
    record(
      "user_settings: getUserSettings returns null for missing row",
      false,
      String(err)
    );
  }

  // Restore the original user_settings row (or delete if none existed).
  try {
    if (snapshot) {
      userSettings.upsertUserSettings({
        user_id: USER_ID,
        anthropic_key: snapshot.anthropic_key,
        model_pref: snapshot.model_pref,
        timezone: snapshot.timezone,
        monthly_token_cap: snapshot.monthly_token_cap,
      });
    } else {
      userSettings.deleteUserSettings(USER_ID);
    }
    record("user_settings: cleanup restored prior state", true);
  } catch (err) {
    record("user_settings: cleanup restored prior state", false, String(err));
  }

  // ---------------- summary ----------------
  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log(
    `smoke-phase-a: ${results.length - failed.length}/${results.length} passed`
  );
  if (failed.length > 0) {
    console.log("Failures:");
    for (const f of failed) {
      console.log(`  - ${f.name}${f.detail ? ` :: ${f.detail}` : ""}`);
    }
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("smoke-phase-a crashed:", err);
    process.exit(1);
  });
