import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { MAX_SYSTEM_PROMPT_LENGTH } from "@/lib/coach/prompts";

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

  it("encrypts cursor_key on disk and decrypts it on read", async () => {
    const { settings, conn } = await loadModules();
    settings.upsertUserSettings({
      user_id: 1,
      cursor_key: "crsr_PLAINTEXT-MARKER-SHOULD-NOT-LEAK",
    });
    expect(settings.getUserSettings(1)?.cursor_key).toBe(
      "crsr_PLAINTEXT-MARKER-SHOULD-NOT-LEAK",
    );

    const db = conn.openWrite();
    const row = db!
      .prepare(
        "SELECT cursor_key, cursor_key_version FROM user_settings WHERE user_id = 1",
      )
      .get() as { cursor_key: string; cursor_key_version: number };
    db!.close();
    expect(row.cursor_key).not.toContain("PLAINTEXT-MARKER");
    expect(row.cursor_key_version).toBe(1);
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

  it("persists Coach effort without changing the selected model", async () => {
    const { settings } = await loadModules();
    settings.upsertUserSettings({
      user_id: 1,
      model_pref: "anthropic:claude-sonnet-4-6",
      coach_effort: "high",
    });
    settings.upsertUserSettings({ user_id: 1, coach_effort: "max" });

    expect(settings.getUserSettings(1)).toMatchObject({
      model_pref: "anthropic:claude-sonnet-4-6",
      coach_effort: "max",
    });
  });

  it("round-trips per-model Cursor parameters", async () => {
    const { settings } = await loadModules();
    settings.upsertUserSettings({
      user_id: 1,
      cursor_model_params: {
        "gpt-5.5": [{ id: "effort", value: "high" }],
        "claude-opus-4-8": [
          { id: "effort", value: "xhigh" },
          { id: "fast", value: "false" },
        ],
      },
    });

    expect(settings.getUserSettings(1)?.cursor_model_params).toEqual({
      "gpt-5.5": [{ id: "effort", value: "high" }],
      "claude-opus-4-8": [
        { id: "effort", value: "xhigh" },
        { id: "fast", value: "false" },
      ],
    });
  });

  it("undefined input fields leave existing values untouched", async () => {
    const { settings } = await loadModules();
    settings.upsertUserSettings({
      user_id: 1,
      anthropic_key: "k1",
      cursor_key: "crsr_1",
      model_pref: "m1",
      timezone: "UTC",
      monthly_token_cap: 500,
    });
    settings.upsertUserSettings({ user_id: 1, model_pref: "m2" });
    const got = settings.getUserSettings(1);
    expect(got?.anthropic_key).toBe("k1");
    expect(got?.cursor_key).toBe("crsr_1");
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

  it("explicit null clears cursor_key without changing anthropic_key", async () => {
    const { settings } = await loadModules();
    settings.upsertUserSettings({
      user_id: 1,
      anthropic_key: "sk-ant-keep",
      cursor_key: "crsr_remove",
    });
    settings.upsertUserSettings({ user_id: 1, cursor_key: null });
    const got = settings.getUserSettings(1);
    expect(got?.cursor_key).toBeNull();
    expect(got?.anthropic_key).toBe("sk-ant-keep");
  });

  it("isolates independent Cursor keys across users while preserving both providers", async () => {
    const { settings, conn } = await loadModules();
    const db = conn.openWrite();
    db!.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run(
      2,
      "second@example.com",
    );
    db!.close();

    settings.upsertUserSettings({
      user_id: 1,
      anthropic_key: "sk-ant-user-one",
      cursor_key: "key_cursor-user-one",
    });
    settings.upsertUserSettings({
      user_id: 2,
      cursor_key: "key_cursor-user-two",
    });

    expect(settings.getUserSettings(1)).toMatchObject({
      anthropic_key: "sk-ant-user-one",
      cursor_key: "key_cursor-user-one",
    });
    expect(settings.getUserSettings(2)).toMatchObject({
      anthropic_key: null,
      cursor_key: "key_cursor-user-two",
    });
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

  // -------------------------------------------------------------------------
  // Phase E.1 — coach_goals / onboarded_at / tz
  // -------------------------------------------------------------------------

  it("getUserSettings returns null for the three new fields on a bare row", async () => {
    const { settings } = await loadModules();
    settings.upsertUserSettings({ user_id: 1, model_pref: "claude-sonnet-4-6" });
    const got = settings.getUserSettings(1);
    expect(got).not.toBeNull();
    expect(got!.coach_goals).toBeNull();
    expect(got!.onboarded_at).toBeNull();
    expect(got!.tz).toBeNull();
  });

  it("setCoachGoals round-trips an array of strings", async () => {
    const { settings } = await loadModules();
    settings.setCoachGoals(1, ["sleep_better", "manage_stress"]);
    const got = settings.getUserSettings(1);
    expect(got).not.toBeNull();
    expect(got!.coach_goals).toEqual(["sleep_better", "manage_stress"]);
  });

  it("setCoachGoals can persist an empty array distinct from null", async () => {
    const { settings } = await loadModules();
    settings.setCoachGoals(1, []);
    expect(settings.getUserSettings(1)!.coach_goals).toEqual([]);
    settings.setCoachGoals(1, null);
    expect(settings.getUserSettings(1)!.coach_goals).toBeNull();
  });

  it("getUserSettings returns null coach_goals when on-disk JSON is malformed", async () => {
    const { settings, conn } = await loadModules();
    // Seed a real row first so the UPDATE has something to mutate.
    settings.upsertUserSettings({ user_id: 1, model_pref: "claude-sonnet-4-6" });
    const db = conn.openWrite();
    db!
      .prepare("UPDATE user_settings SET coach_goals = ? WHERE user_id = 1")
      .run("not json");
    db!.close();
    const got = settings.getUserSettings(1);
    expect(got).not.toBeNull();
    expect(got!.coach_goals).toBeNull();
    // Other columns still populated — malformed goals don't poison the row.
    expect(got!.model_pref).toBe("claude-sonnet-4-6");
  });

  it("markOnboarded is idempotent — second call returns the original stamp", async () => {
    const { settings } = await loadModules();
    const first = settings.markOnboarded(1);
    expect(first).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Sleep so a fresh `new Date()` would produce a different ISO.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = settings.markOnboarded(1);
    expect(second).toBe(first);
  });

  it("markOnboarded throws UserSettingsUserMissingError for unknown user_id", async () => {
    const { settings } = await loadModules();
    expect(() => settings.markOnboarded(9999)).toThrow(
      settings.UserSettingsUserMissingError
    );
  });

  it("markOnboarded — two back-to-back calls return the FIRST stamp", async () => {
    // Tightens the idempotency guarantee. Since better-sqlite3 is sync, true
    // OS-thread concurrency isn't expressible — but the implementation uses a
    // single INSERT … ON CONFLICT … RETURNING statement, so the outcome is
    // identical under ANY interleaving (the COALESCE chooses the existing
    // value once the row exists). Two back-to-back calls is the strongest
    // observable assertion at this layer.
    const { settings } = await loadModules();
    const first = settings.markOnboarded(1, new Date("2026-05-01T00:00:00Z"));
    const second = settings.markOnboarded(1, new Date("2026-05-02T00:00:00Z"));
    expect(first).toBe("2026-05-01T00:00:00.000Z");
    expect(second).toBe("2026-05-01T00:00:00.000Z");
  });

  it("setTzIfUnset returns true on the first write, false on subsequent calls", async () => {
    const { settings } = await loadModules();
    expect(settings.setTzIfUnset(1, "America/New_York")).toBe(true);
    expect(settings.getUserSettings(1)!.tz).toBe("America/New_York");
    // Second call must not overwrite the existing tz.
    expect(settings.setTzIfUnset(1, "Europe/Berlin")).toBe(false);
    expect(settings.getUserSettings(1)!.tz).toBe("America/New_York");
  });

  it("setTzIfUnset throws UserSettingsUserMissingError for unknown user_id", async () => {
    const { settings } = await loadModules();
    expect(() => settings.setTzIfUnset(9999, "America/New_York")).toThrow(
      settings.UserSettingsUserMissingError
    );
  });

  // -------------------------------------------------------------------------
  // Issue #493 — system_prompt is per-user, not a global app_setting
  // -------------------------------------------------------------------------

  it("system_prompt is null on a bare row", async () => {
    const { settings } = await loadModules();
    settings.upsertUserSettings({ user_id: 1, model_pref: "claude-sonnet-4-6" });
    expect(settings.getUserSettings(1)?.system_prompt).toBeNull();
  });

  it("round-trips a per-user system_prompt", async () => {
    const { settings } = await loadModules();
    settings.upsertUserSettings({
      user_id: 1,
      system_prompt: "Be extra terse and always cite HRV trend.",
    });
    expect(settings.getUserSettings(1)?.system_prompt).toBe(
      "Be extra terse and always cite HRV trend.",
    );
  });

  it("explicit null clears system_prompt without touching other columns", async () => {
    const { settings } = await loadModules();
    settings.upsertUserSettings({
      user_id: 1,
      model_pref: "claude-sonnet-4-6",
      system_prompt: "custom instructions",
    });
    settings.upsertUserSettings({ user_id: 1, system_prompt: null });
    const got = settings.getUserSettings(1);
    expect(got?.system_prompt).toBeNull();
    expect(got?.model_pref).toBe("claude-sonnet-4-6");
  });

  it("undefined system_prompt leaves the existing value untouched", async () => {
    const { settings } = await loadModules();
    settings.upsertUserSettings({
      user_id: 1,
      system_prompt: "keep me",
    });
    settings.upsertUserSettings({ user_id: 1, model_pref: "claude-sonnet-4-6" });
    expect(settings.getUserSettings(1)?.system_prompt).toBe("keep me");
  });

  it("isolates system_prompt across users — user A's write does not affect user B", async () => {
    const { settings, conn } = await loadModules();
    const db = conn.openWrite();
    db!.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run(
      2,
      "second@example.com",
    );
    db!.close();

    settings.upsertUserSettings({
      user_id: 1,
      system_prompt: "user one's private instructions",
    });
    settings.upsertUserSettings({
      user_id: 2,
      system_prompt: "user two's private instructions",
    });

    expect(settings.getUserSettings(1)?.system_prompt).toBe(
      "user one's private instructions",
    );
    expect(settings.getUserSettings(2)?.system_prompt).toBe(
      "user two's private instructions",
    );
  });

  // Defense in depth (fable review, MEDIUM follow-up) — the settings route
  // is the only writer today and already rejects an overlong system_prompt
  // with a 400 before ever calling upsertUserSettings, so this never fires
  // through the live route. It exists so a future caller bypassing the
  // route can't silently store an unbounded prompt straight into the DB.
  it("rejects a system_prompt over MAX_SYSTEM_PROMPT_LENGTH and persists nothing", async () => {
    const { settings } = await loadModules();
    const overlong = "x".repeat(MAX_SYSTEM_PROMPT_LENGTH + 1);
    expect(() =>
      settings.upsertUserSettings({ user_id: 1, system_prompt: overlong }),
    ).toThrow(settings.SystemPromptTooLongError);
    expect(settings.getUserSettings(1)).toBeNull();
  });

  it("accepts a system_prompt exactly at MAX_SYSTEM_PROMPT_LENGTH", async () => {
    const { settings } = await loadModules();
    const atCap = "x".repeat(MAX_SYSTEM_PROMPT_LENGTH);
    settings.upsertUserSettings({ user_id: 1, system_prompt: atCap });
    expect(settings.getUserSettings(1)?.system_prompt).toBe(atCap);
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
