import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

vi.mock("server-only", () => ({}));

function freshDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "user-settings-itest-"));
  const p = path.join(dir, "whoop_data.db");
  // openWrite() requires the file to exist (existsSync gate). Touch it.
  fs.writeFileSync(p, "");
  return p;
}

function freshKey(): string {
  return crypto.randomBytes(32).toString("base64");
}

describe("user_settings + vault", () => {
  let dbPath: string;
  let originalKey: string | undefined;
  let originalDbPath: string | undefined;

  beforeEach(() => {
    originalKey = process.env.VAULT_KEY;
    originalDbPath = process.env.WHOOP_DB_PATH;
    dbPath = freshDbPath();
    process.env.VAULT_KEY = freshKey();
    process.env.WHOOP_DB_PATH = dbPath;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.VAULT_KEY;
    else process.env.VAULT_KEY = originalKey;
    if (originalDbPath === undefined) delete process.env.WHOOP_DB_PATH;
    else process.env.WHOOP_DB_PATH = originalDbPath;
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  async function loadModules() {
    const conn = await import("./connection");
    const db = conn.openWrite();
    expect(db).not.toBeNull();
    db?.close();
    const settings = await import("./user_settings");
    const vault = await import("@/lib/crypto/vault");
    return { conn, settings, vault };
  }

  it("returns null when no row exists", async () => {
    const { settings } = await loadModules();
    expect(settings.getUserSettings(1)).toBeNull();
  });

  it("encrypts anthropic_key on write, decrypts on read", async () => {
    const { settings } = await loadModules();
    settings.upsertUserSettings({
      user_id: 1,
      anthropic_key: "sk-ant-test-key-XYZ",
      model_pref: "claude-sonnet-4-6",
      timezone: "America/New_York",
      monthly_token_cap: 1_000_000,
    });
    const got = settings.getUserSettings(1);
    expect(got).not.toBeNull();
    expect(got!.anthropic_key).toBe("sk-ant-test-key-XYZ");
    expect(got!.model_pref).toBe("claude-sonnet-4-6");
    expect(got!.timezone).toBe("America/New_York");
    expect(got!.monthly_token_cap).toBe(1_000_000);
    expect(typeof got!.updated_at).toBe("string");
  });

  it("on-disk anthropic_key column is ciphertext, not plaintext", async () => {
    const { settings, conn } = await loadModules();
    settings.upsertUserSettings({
      user_id: 1,
      anthropic_key: "PLAINTEXT-MARKER-SHOULD-NOT-LEAK",
    });
    const db = conn.openWrite();
    const row = db!
      .prepare(
        "SELECT anthropic_key, anthropic_key_version FROM user_settings WHERE user_id = 1"
      )
      .get() as { anthropic_key: string; anthropic_key_version: number };
    db!.close();
    expect(row.anthropic_key).not.toContain("PLAINTEXT-MARKER");
    expect(row.anthropic_key_version).toBe(1);
  });

  it("upsert is idempotent — second call replaces existing row", async () => {
    const { settings } = await loadModules();
    settings.upsertUserSettings({
      user_id: 1,
      anthropic_key: "k1",
      model_pref: "m1",
    });
    settings.upsertUserSettings({
      user_id: 1,
      anthropic_key: "k2",
      model_pref: "m2",
    });
    const got = settings.getUserSettings(1);
    expect(got?.anthropic_key).toBe("k2");
    expect(got?.model_pref).toBe("m2");
  });

  it("undefined input fields leave existing values untouched", async () => {
    const { settings } = await loadModules();
    settings.upsertUserSettings({
      user_id: 1,
      anthropic_key: "k1",
      model_pref: "m1",
      timezone: "UTC",
      monthly_token_cap: 500,
    });
    settings.upsertUserSettings({ user_id: 1, model_pref: "m2" });
    const got = settings.getUserSettings(1);
    expect(got?.anthropic_key).toBe("k1");
    expect(got?.model_pref).toBe("m2");
    expect(got?.timezone).toBe("UTC");
    expect(got?.monthly_token_cap).toBe(500);
  });

  it("explicit null clears anthropic_key (BYOK opt-out)", async () => {
    const { settings } = await loadModules();
    settings.upsertUserSettings({ user_id: 1, anthropic_key: "k1" });
    expect(settings.getUserSettings(1)?.anthropic_key).toBe("k1");
    settings.upsertUserSettings({ user_id: 1, anthropic_key: null });
    expect(settings.getUserSettings(1)?.anthropic_key).toBeNull();
  });

  it("updated_at advances on subsequent writes", async () => {
    const { settings } = await loadModules();
    settings.upsertUserSettings({ user_id: 1, model_pref: "m1" });
    const first = settings.getUserSettings(1)!.updated_at;
    // 10ms gap is enough — ISO strings have ms precision.
    await new Promise((resolve) => setTimeout(resolve, 10));
    settings.upsertUserSettings({ user_id: 1, model_pref: "m2" });
    const second = settings.getUserSettings(1)!.updated_at;
    expect(second > first).toBe(true);
  });

  it("throws UserSettingsUserMissingError for unknown user_id", async () => {
    const { settings } = await loadModules();
    expect(() =>
      settings.upsertUserSettings({ user_id: 9999, model_pref: "m1" })
    ).toThrow(settings.UserSettingsUserMissingError);
  });

  it("getUserSettings surfaces null anthropic_key but other columns when ciphertext is tampered", async () => {
    const { settings, conn } = await loadModules();
    settings.upsertUserSettings({
      user_id: 1,
      anthropic_key: "real-key",
      model_pref: "claude-sonnet-4-6",
    });
    const db = conn.openWrite();
    db!
      .prepare(
        "UPDATE user_settings SET anthropic_key = ? WHERE user_id = 1"
      )
      .run("not-real-base64-but-tampered");
    db!.close();
    const got = settings.getUserSettings(1);
    expect(got).not.toBeNull();
    expect(got!.anthropic_key).toBeNull();
    expect(got!.model_pref).toBe("claude-sonnet-4-6");
  });

  it("getUserSettings returns null anthropic_key when VAULT_KEY is unset", async () => {
    const { settings } = await loadModules();
    settings.upsertUserSettings({ user_id: 1, anthropic_key: "real-key" });
    const saved = process.env.VAULT_KEY;
    delete process.env.VAULT_KEY;
    try {
      const got = settings.getUserSettings(1);
      expect(got).not.toBeNull();
      expect(got!.anthropic_key).toBeNull();
    } finally {
      process.env.VAULT_KEY = saved;
    }
  });

  it("getUserSettings drops anthropic_key when stored version is unsupported", async () => {
    const { settings, conn } = await loadModules();
    settings.upsertUserSettings({
      user_id: 1,
      anthropic_key: "real-key",
      model_pref: "claude-sonnet-4-6",
    });
    const db = conn.openWrite();
    db!
      .prepare("UPDATE user_settings SET anthropic_key_version = 999 WHERE user_id = 1")
      .run();
    db!.close();
    const got = settings.getUserSettings(1);
    expect(got).not.toBeNull();
    expect(got!.anthropic_key).toBeNull();
    expect(got!.model_pref).toBe("claude-sonnet-4-6");
  });

  it("deleteUserSettings removes the row idempotently", async () => {
    const { settings } = await loadModules();
    settings.upsertUserSettings({ user_id: 1, model_pref: "m1" });
    expect(settings.getUserSettings(1)).not.toBeNull();
    expect(settings.deleteUserSettings(1)).toBe(1);
    expect(settings.getUserSettings(1)).toBeNull();
    // Second delete is a no-op.
    expect(settings.deleteUserSettings(1)).toBe(0);
  });

  it("assertVaultKeyConfigured passes when key is valid and throws when not", async () => {
    const { vault } = await loadModules();
    expect(() => vault.assertVaultKeyConfigured()).not.toThrow();
    const saved = process.env.VAULT_KEY;
    delete process.env.VAULT_KEY;
    try {
      expect(() => vault.assertVaultKeyConfigured()).toThrow(
        vault.VaultMissingKeyError
      );
    } finally {
      process.env.VAULT_KEY = saved;
    }
  });

  it("assertVaultKeyConfigured rejects wrong-length keys", async () => {
    const { vault } = await loadModules();
    const saved = process.env.VAULT_KEY;
    process.env.VAULT_KEY = Buffer.from("too-short").toString("base64");
    try {
      expect(() => vault.assertVaultKeyConfigured()).toThrow(
        vault.VaultMissingKeyError
      );
    } finally {
      process.env.VAULT_KEY = saved;
    }
  });
});
