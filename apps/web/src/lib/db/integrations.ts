import "server-only";
// Encrypted credentials storage for OAuth providers (Whoop today, more later).
//
// Convention:
//   - DB column for OAuth scopes is named `scopes` (plural).
//   - Public API key on the integration object is `scope` (singular), to
//     match the Whoop OAuth response and the legacy tokens.json shape.
//   - `expires_at` is always an ISO 8601 string (e.g. "2026-05-09T18:42:11+00:00").
//     Floats are not accepted at this layer.
//   - `key_version` is a small int that pairs the row with the key used to
//     encrypt it. v1 is the only supported version today; rotation will
//     introduce v2 etc. and tooling for re-encrypt-and-bump.

import {
  CURRENT_KEY_VERSION,
  VaultDecryptError,
  VaultMissingKeyError,
  assertKeyVersionSupported,
  decrypt,
  encrypt,
} from "@/lib/crypto/vault";
import { hasTable, open, openWrite, type DB } from "./connection";

export type Integration = {
  user_id: number;
  provider: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scope: string | null;
  token_type: string | null;
  raw: Record<string, unknown> | null;
  key_version: number;
  updated_at: string;
};

export type IntegrationInput = {
  user_id: number;
  provider: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  // Accept either `scope` (singular, Whoop OAuth shape) or `scopes` (plural).
  scope?: string | null;
  scopes?: string | null;
  token_type?: string | null;
  raw?: Record<string, unknown> | null;
};

export class IntegrationUserMissingError extends Error {
  constructor(userId: number) {
    super(
      `user_id=${userId} not found in users table; bootstrap user first`
    );
    this.name = "IntegrationUserMissingError";
  }
}

function ensureIntegrationsTable(db: DB): void {
  // connection.openWrite() already ensures the table exists, but a few code
  // paths (tests using their own DB) may not invoke openWrite first. Cheap
  // idempotent CREATE here keeps the helpers self-contained.
  db.exec(`
    CREATE TABLE IF NOT EXISTS integrations (
      user_id INTEGER NOT NULL REFERENCES users(id),
      provider TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      scopes TEXT,
      token_type TEXT,
      raw TEXT,
      key_version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, provider)
    );
  `);
  // Lazy ALTER for an older shape that pre-dated key_version.
  const cols = db.prepare("PRAGMA table_info(integrations)").all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === "key_version")) {
    db.exec(
      "ALTER TABLE integrations ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1"
    );
  }
}

function userExists(db: DB, userId: number): boolean {
  const row = db
    .prepare("SELECT 1 AS one FROM users WHERE id = ?")
    .get(userId) as { one: number } | undefined;
  return !!row;
}

function pickScope(input: IntegrationInput): string | null {
  if (input.scope !== undefined) return input.scope;
  if (input.scopes !== undefined) return input.scopes;
  return null;
}

/**
 * Insert or update an integration row.
 *
 * Throws:
 *   - VaultMissingKeyError if VAULT_KEY is unset/invalid
 *   - IntegrationUserMissingError if user_id has no users(id) row
 *   - any sqlite error (FK, etc.) bubbles up unchanged
 */
export function upsertIntegration(input: IntegrationInput): void {
  const db = openWrite();
  if (!db) throw new Error("DB unavailable");
  try {
    ensureIntegrationsTable(db);
    if (!userExists(db, input.user_id)) {
      throw new IntegrationUserMissingError(input.user_id);
    }
    const accessCt = encrypt(input.access_token);
    const refreshCt = encrypt(input.refresh_token);
    const scopeValue = pickScope(input);
    const rawJson = input.raw === undefined || input.raw === null
      ? null
      : JSON.stringify(input.raw);
    db.prepare(
      `
      INSERT INTO integrations (
        user_id, provider, access_token, refresh_token, expires_at,
        scopes, token_type, raw, key_version, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, provider) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        scopes = excluded.scopes,
        token_type = excluded.token_type,
        raw = excluded.raw,
        key_version = excluded.key_version,
        updated_at = excluded.updated_at
      `
    ).run(
      input.user_id,
      input.provider,
      accessCt,
      refreshCt,
      input.expires_at,
      scopeValue,
      input.token_type ?? null,
      rawJson,
      CURRENT_KEY_VERSION,
      new Date().toISOString()
    );
  } finally {
    db.close();
  }
}

type IntegrationRowRaw = {
  user_id: number;
  provider: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scopes: string | null;
  token_type: string | null;
  raw: string | null;
  key_version: number;
  updated_at: string;
};

/**
 * Returns true iff a row exists for (user_id, provider). Does NOT decrypt.
 *
 * Use this to distinguish "no row at all" from "row exists but decrypt
 * failed" — the file-fallback in load_tokens uses this to know it should
 * not silently mask a corrupt row by reading tokens.json.
 */
export function integrationRowExists(
  user_id: number,
  provider: string
): boolean {
  // Read-only open: this is a pure existence check and we don't want to
  // trigger lazy-ALTER bookkeeping on every call.
  const db = open();
  if (!db) return false;
  try {
    if (!hasTable(db, "integrations")) return false;
    const row = db
      .prepare(
        "SELECT 1 AS one FROM integrations WHERE user_id = ? AND provider = ?"
      )
      .get(user_id, provider) as { one: number } | undefined;
    return !!row;
  } finally {
    db.close();
  }
}

/**
 * Returns the decrypted integration, or null if:
 *   - the row does not exist
 *   - VAULT_KEY is unset
 *   - the row's key_version is not supported
 *   - decryption fails (e.g. wrong key, tampered ciphertext)
 *
 * Decryption errors are intentionally swallowed and logged. Callers that
 * need to distinguish "no row" from "row but unreadable" should pair this
 * with `integrationRowExists`.
 */
export function getIntegration(
  user_id: number,
  provider: string
): Integration | null {
  const db = openWrite();
  if (!db) return null;
  try {
    if (!hasTable(db, "integrations")) return null;
    const row = db
      .prepare(
        `
        SELECT user_id, provider, access_token, refresh_token, expires_at,
               scopes, token_type, raw, key_version, updated_at
        FROM integrations
        WHERE user_id = ? AND provider = ?
        `
      )
      .get(user_id, provider) as IntegrationRowRaw | undefined;
    if (!row) return null;
    try {
      assertKeyVersionSupported(row.key_version);
      const access = decrypt(row.access_token);
      const refresh = decrypt(row.refresh_token);
      let raw: Record<string, unknown> | null = null;
      if (row.raw) {
        try {
          raw = JSON.parse(row.raw) as Record<string, unknown>;
        } catch {
          raw = null;
        }
      }
      return {
        user_id: row.user_id,
        provider: row.provider,
        access_token: access,
        refresh_token: refresh,
        expires_at: row.expires_at,
        scope: row.scopes,
        token_type: row.token_type,
        raw,
        key_version: row.key_version,
        updated_at: row.updated_at,
      };
    } catch (err) {
      if (
        err instanceof VaultDecryptError ||
        err instanceof VaultMissingKeyError
      ) {
        // Surface in server logs; callers see null and can decide what to do.
        console.error(
          `[integrations] decrypt failed for user_id=${user_id} provider=${provider}: ${err.message}`
        );
        return null;
      }
      throw err;
    }
  } finally {
    db.close();
  }
}

export function deleteIntegration(user_id: number, provider: string): void {
  const db = openWrite();
  if (!db) return;
  try {
    if (!hasTable(db, "integrations")) return;
    db.prepare(
      "DELETE FROM integrations WHERE user_id = ? AND provider = ?"
    ).run(user_id, provider);
  } finally {
    db.close();
  }
}
