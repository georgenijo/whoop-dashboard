import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

vi.mock("server-only", () => ({}));

// IMPORTANT: set VAULT_KEY + WHOOP_DB_PATH BEFORE importing the modules that
// read them at load time — `connection.ts` defers DB opens, but vault.ts's
// `process.env.VAULT_KEY` is read inside encrypt/decrypt (lazy), so order of
// imports vs env doesn't strictly matter. Still safer to set up first.

function freshDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-itest-"));
  const p = path.join(dir, "whoop_data.db");
  // openWrite() requires the file to exist (existsSync gate). Touch it.
  fs.writeFileSync(p, "");
  return p;
}

function freshKey(): string {
  return crypto.randomBytes(32).toString("base64");
}

describe("integrations + vault", () => {
  let dbPath: string;
  let originalKey: string | undefined;
  let originalDbPath: string | undefined;

  beforeEach(() => {
    originalKey = process.env.VAULT_KEY;
    originalDbPath = process.env.WHOOP_DB_PATH;
    dbPath = freshDbPath();
    process.env.VAULT_KEY = freshKey();
    process.env.WHOOP_DB_PATH = dbPath;
    // Reset module cache so connection.ts re-reads env on each test.
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
    // Open + close once so the schema (incl. users + integrations) is created.
    const db = conn.openWrite();
    expect(db).not.toBeNull();
    db?.close();
    const integrations = await import("./integrations");
    const vault = await import("@/lib/crypto/vault");
    return { conn, integrations, vault };
  }

  it("encrypts on insert, decrypts on read (round-trip)", async () => {
    const { integrations } = await loadModules();
    integrations.upsertIntegration({
      user_id: 1,
      provider: "whoop",
      access_token: "access-abc",
      refresh_token: "refresh-xyz",
      expires_at: "2026-05-09T18:42:11+00:00",
      scope: "offline read:profile",
      token_type: "bearer",
      raw: { ext: "value" },
    });
    const got = integrations.getIntegration(1, "whoop");
    expect(got).not.toBeNull();
    expect(got!.access_token).toBe("access-abc");
    expect(got!.refresh_token).toBe("refresh-xyz");
    expect(got!.scope).toBe("offline read:profile");
    expect(got!.token_type).toBe("bearer");
    expect(got!.expires_at).toBe("2026-05-09T18:42:11+00:00");
    expect(got!.key_version).toBe(1);
    expect(got!.raw).toEqual({ ext: "value" });
  });

  it("ON CONFLICT update overwrites the prior row in place", async () => {
    const { integrations } = await loadModules();
    integrations.upsertIntegration({
      user_id: 1,
      provider: "whoop",
      access_token: "v1",
      refresh_token: "r1",
      expires_at: "2026-05-09T00:00:00+00:00",
    });
    integrations.upsertIntegration({
      user_id: 1,
      provider: "whoop",
      access_token: "v2",
      refresh_token: "r2",
      expires_at: "2026-05-10T00:00:00+00:00",
    });
    const got = integrations.getIntegration(1, "whoop");
    expect(got?.access_token).toBe("v2");
    expect(got?.refresh_token).toBe("r2");
    expect(got?.expires_at).toBe("2026-05-10T00:00:00+00:00");
  });

  it("getIntegration returns null on tampered ciphertext", async () => {
    const { integrations, conn } = await loadModules();
    integrations.upsertIntegration({
      user_id: 1,
      provider: "whoop",
      access_token: "access-abc",
      refresh_token: "refresh-xyz",
      expires_at: "2026-05-09T18:42:11+00:00",
    });
    // Corrupt the access_token ciphertext directly.
    const db = conn.openWrite();
    db!
      .prepare(
        "UPDATE integrations SET access_token = ? WHERE user_id = ? AND provider = ?"
      )
      .run("not-real-base64-but-tampered", 1, "whoop");
    db!.close();
    const got = integrations.getIntegration(1, "whoop");
    expect(got).toBeNull();
    // ...and integrationRowExists still reports true so the caller can
    // distinguish "no row" from "row but unreadable".
    expect(integrations.integrationRowExists(1, "whoop")).toBe(true);
  });

  it("getIntegration returns null when VAULT_KEY is missing", async () => {
    const { integrations } = await loadModules();
    integrations.upsertIntegration({
      user_id: 1,
      provider: "whoop",
      access_token: "access-abc",
      refresh_token: "refresh-xyz",
      expires_at: "2026-05-09T18:42:11+00:00",
    });
    const saved = process.env.VAULT_KEY;
    delete process.env.VAULT_KEY;
    try {
      const got = integrations.getIntegration(1, "whoop");
      expect(got).toBeNull();
    } finally {
      process.env.VAULT_KEY = saved;
    }
  });

  it("getIntegration returns null when key_version is unsupported", async () => {
    const { integrations, conn } = await loadModules();
    integrations.upsertIntegration({
      user_id: 1,
      provider: "whoop",
      access_token: "a",
      refresh_token: "r",
      expires_at: "2026-05-09T00:00:00+00:00",
    });
    const db = conn.openWrite();
    db!
      .prepare("UPDATE integrations SET key_version = 99 WHERE user_id = ?")
      .run(1);
    db!.close();
    expect(integrations.getIntegration(1, "whoop")).toBeNull();
    expect(integrations.integrationRowExists(1, "whoop")).toBe(true);
  });

  it("upsertIntegration throws IntegrationUserMissingError for unknown user_id", async () => {
    const { integrations } = await loadModules();
    expect(() =>
      integrations.upsertIntegration({
        user_id: 9999,
        provider: "whoop",
        access_token: "a",
        refresh_token: "r",
        expires_at: "2026-05-09T00:00:00+00:00",
      })
    ).toThrow(integrations.IntegrationUserMissingError);
  });

  it("accepts both `scope` and `scopes` keys; reads back as `scope`", async () => {
    const { integrations } = await loadModules();
    integrations.upsertIntegration({
      user_id: 1,
      provider: "whoop",
      access_token: "a",
      refresh_token: "r",
      expires_at: "2026-05-09T00:00:00+00:00",
      scopes: "offline read:recovery",
    });
    const got = integrations.getIntegration(1, "whoop");
    expect(got?.scope).toBe("offline read:recovery");
  });

  it("encrypt/decrypt symmetry through the vault module", async () => {
    const { vault } = await loadModules();
    const blob = vault.encrypt("hello world");
    expect(typeof blob).toBe("string");
    expect(vault.decrypt(blob)).toBe("hello world");
  });

  it("vault.decrypt throws VaultDecryptError on tampered blob", async () => {
    const { vault } = await loadModules();
    const blob = vault.encrypt("hello");
    // Flip a byte in the ciphertext portion (after the 24-byte nonce).
    const buf = Buffer.from(blob, "base64");
    buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff;
    const tampered = buf.toString("base64");
    expect(() => vault.decrypt(tampered)).toThrow(vault.VaultDecryptError);
  });

  it("vault.encrypt throws VaultMissingKeyError when VAULT_KEY is unset", async () => {
    const { vault } = await loadModules();
    const saved = process.env.VAULT_KEY;
    delete process.env.VAULT_KEY;
    try {
      expect(() => vault.encrypt("x")).toThrow(vault.VaultMissingKeyError);
    } finally {
      process.env.VAULT_KEY = saved;
    }
  });

  it("deleteIntegration removes the row but leaves the table", async () => {
    const { integrations } = await loadModules();
    integrations.upsertIntegration({
      user_id: 1,
      provider: "whoop",
      access_token: "a",
      refresh_token: "r",
      expires_at: "2026-05-09T00:00:00+00:00",
    });
    expect(integrations.integrationRowExists(1, "whoop")).toBe(true);
    integrations.deleteIntegration(1, "whoop");
    expect(integrations.integrationRowExists(1, "whoop")).toBe(false);
    // Idempotent.
    integrations.deleteIntegration(1, "whoop");
  });

  // ---------- BLOCK 1+2: saveTokens must NOT persist plaintext credentials
  // in the unencrypted `raw` column. We read the row directly via raw SQL
  // (NOT getIntegration, which decrypts) and assert raw is NULL on disk.
  it("saveTokens writes a NULL `raw` column (no plaintext leak)", async () => {
    const { conn } = await loadModules();
    // Bootstrap user 1 so saveTokens' upsert succeeds.
    const bootstrap = conn.openWrite();
    expect(bootstrap).not.toBeNull();
    bootstrap!.exec("INSERT OR IGNORE INTO users (id) VALUES (1)");
    bootstrap!.close();

    // Point tokens.json at a tmp path so we don't touch the repo file.
    const tokensTmp = path.join(path.dirname(dbPath), "tokens.json");
    process.env.WHOOP_TOKENS_PATH = tokensTmp;
    try {
      const auth = await import("@/lib/auth");
      await auth.saveTokens(1, {
        access_token: "PLAINTEXT-ACCESS-SHOULD-NEVER-LAND-IN-RAW",
        refresh_token: "PLAINTEXT-REFRESH-SHOULD-NEVER-LAND-IN-RAW",
        expires_at: "2026-05-09T18:42:11+00:00",
        expires_in: 3600,
        token_type: "bearer",
        scope: "offline read:profile",
      });

      const db = conn.openWrite();
      expect(db).not.toBeNull();
      const row = db!
        .prepare(
          "SELECT access_token, refresh_token, raw FROM integrations WHERE user_id = ? AND provider = ?"
        )
        .get(1, "whoop") as
        | {
            access_token: string;
            refresh_token: string;
            raw: string | null;
          }
        | undefined;
      db!.close();

      expect(row).toBeDefined();
      // Hard invariant: on-disk `raw` MUST be NULL.
      expect(row!.raw).toBeNull();
      // Defense-in-depth: the encrypted columns must NOT contain the
      // plaintext substrings (i.e. encryption ran).
      expect(row!.access_token).not.toContain("PLAINTEXT-ACCESS");
      expect(row!.refresh_token).not.toContain("PLAINTEXT-REFRESH");
    } finally {
      delete process.env.WHOOP_TOKENS_PATH;
      try {
        fs.unlinkSync(tokensTmp);
      } catch {
        // ignore
      }
    }
  });

  // BLOCK 3 — Node side: there is no Node `clearTokens` equivalent today
  // (token clearing lives in streamlit/whoop/auth.py only, since the web
  // surface doesn't expose a Disconnect action). The test for "clearTokens
  // preserves tokens.json" lives in tests/test_integrations.py. If a Node
  // clearTokens is added later, mirror that test here.

  it("setIntegrationNeedsReauth flips the flag and getIntegration reflects it", async () => {
    const { integrations } = await loadModules();
    integrations.upsertIntegration({
      user_id: 1,
      provider: "whoop",
      access_token: "a",
      refresh_token: "r",
      expires_at: "2026-05-09T00:00:00+00:00",
    });
    // Fresh write defaults to false.
    expect(integrations.getIntegration(1, "whoop")?.needs_reauth).toBe(false);
    integrations.setIntegrationNeedsReauth(1, "whoop", true);
    expect(integrations.getIntegration(1, "whoop")?.needs_reauth).toBe(true);
  });

  it("upsertIntegration resets needs_reauth to false on every write", async () => {
    const { integrations } = await loadModules();
    integrations.upsertIntegration({
      user_id: 1,
      provider: "whoop",
      access_token: "a",
      refresh_token: "r",
      expires_at: "2026-05-09T00:00:00+00:00",
    });
    integrations.setIntegrationNeedsReauth(1, "whoop", true);
    expect(integrations.getIntegration(1, "whoop")?.needs_reauth).toBe(true);
    // Simulate a successful refresh — saveTokens → upsertIntegration.
    integrations.upsertIntegration({
      user_id: 1,
      provider: "whoop",
      access_token: "a2",
      refresh_token: "r2",
      expires_at: "2026-05-10T00:00:00+00:00",
    });
    expect(integrations.getIntegration(1, "whoop")?.needs_reauth).toBe(false);
  });
});
