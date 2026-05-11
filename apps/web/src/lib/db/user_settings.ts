import "server-only";
// Per-user application preferences. Single row per user, lazy-created on
// first upsert. Mirrors the `integrations` table's encryption strategy:
// `anthropic_key` is symmetric-encrypted with VAULT_KEY (NaCl secretbox)
// and tagged with `anthropic_key_version` so future key rotations don't
// silently produce undecryptable garbage.
//
// NULL `anthropic_key` is meaningful: it means "use server fallback"
// (BYOK opt-out). A row may exist with anthropic_key=NULL and model_pref
// set — that's the common case once Settings UI lands.

import {
  CURRENT_KEY_VERSION,
  VaultDecryptError,
  VaultMissingKeyError,
  assertKeyVersionSupported,
  decrypt,
  encrypt,
} from "@/lib/crypto/vault";
import { hasTable, openWrite, type DB } from "./connection";

export type UserSettings = {
  user_id: number;
  anthropic_key: string | null;
  model_pref: string | null;
  timezone: string | null;
  monthly_token_cap: number | null;
  updated_at: string;
};

export type UserSettingsInput = {
  user_id: number;
  // `undefined` = leave existing column untouched. `null` = clear the column.
  anthropic_key?: string | null;
  model_pref?: string | null;
  timezone?: string | null;
  monthly_token_cap?: number | null;
};

export class UserSettingsUserMissingError extends Error {
  constructor(userId: number) {
    super(
      `user_id=${userId} not found in users table; bootstrap user first`
    );
    this.name = "UserSettingsUserMissingError";
  }
}

function ensureUserSettingsTable(db: DB): void {
  // openWrite() already creates this, but standalone callers (tests with
  // their own DB) skip openWrite — keep this CREATE TABLE idempotent so
  // helpers stay self-contained.
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      anthropic_key TEXT,
      anthropic_key_version INTEGER,
      model_pref TEXT,
      timezone TEXT,
      monthly_token_cap INTEGER,
      updated_at TEXT NOT NULL
    );
  `);
}

function userExists(db: DB, userId: number): boolean {
  const row = db
    .prepare("SELECT 1 AS one FROM users WHERE id = ?")
    .get(userId) as { one: number } | undefined;
  return !!row;
}

type UserSettingsRowRaw = {
  user_id: number;
  anthropic_key: string | null;
  anthropic_key_version: number | null;
  model_pref: string | null;
  timezone: string | null;
  monthly_token_cap: number | null;
  updated_at: string;
};

/**
 * Returns the user's settings row with `anthropic_key` decrypted, or null
 * if no row exists for this user_id.
 *
 * Returns the row but with `anthropic_key = null` if decryption fails
 * (missing/wrong VAULT_KEY, unsupported key_version, tampered ciphertext).
 * The non-secret columns are still returned so the UI can render model_pref
 * etc. without locking up on a key issue. Errors are logged server-side.
 */
export function getUserSettings(user_id: number): UserSettings | null {
  const db = openWrite();
  if (!db) return null;
  try {
    if (!hasTable(db, "user_settings")) return null;
    const row = db
      .prepare(
        `
        SELECT user_id, anthropic_key, anthropic_key_version, model_pref,
               timezone, monthly_token_cap, updated_at
        FROM user_settings
        WHERE user_id = ?
        `
      )
      .get(user_id) as UserSettingsRowRaw | undefined;
    if (!row) return null;

    let decryptedAnthropic: string | null = null;
    if (row.anthropic_key !== null) {
      try {
        assertKeyVersionSupported(row.anthropic_key_version ?? 0);
        decryptedAnthropic = decrypt(row.anthropic_key);
      } catch (err) {
        if (
          err instanceof VaultDecryptError ||
          err instanceof VaultMissingKeyError
        ) {
          console.error(
            `[user_settings] anthropic_key decrypt failed for user_id=${user_id}: ${err.message}`
          );
          decryptedAnthropic = null;
        } else {
          throw err;
        }
      }
    }

    return {
      user_id: row.user_id,
      anthropic_key: decryptedAnthropic,
      model_pref: row.model_pref,
      timezone: row.timezone,
      monthly_token_cap: row.monthly_token_cap,
      updated_at: row.updated_at,
    };
  } finally {
    db.close();
  }
}

/**
 * Insert-or-update the row. Columns absent from `input` are left as-is on
 * existing rows; on first insert they default to NULL.
 *
 * `anthropic_key`:
 *   - `undefined` → leave the column unchanged
 *   - `null`      → clear the column (and key_version)
 *   - string      → encrypt with VAULT_KEY and store ciphertext + key_version
 *
 * Throws:
 *   - VaultMissingKeyError if anthropic_key is a string but VAULT_KEY is unset
 *   - UserSettingsUserMissingError if user_id has no users(id) row
 */
export function upsertUserSettings(input: UserSettingsInput): void {
  const db = openWrite();
  if (!db) throw new Error("DB unavailable");
  try {
    ensureUserSettingsTable(db);
    if (!userExists(db, input.user_id)) {
      throw new UserSettingsUserMissingError(input.user_id);
    }

    const existing = db
      .prepare(
        `
        SELECT anthropic_key, anthropic_key_version, model_pref, timezone,
               monthly_token_cap
        FROM user_settings
        WHERE user_id = ?
        `
      )
      .get(input.user_id) as
      | {
          anthropic_key: string | null;
          anthropic_key_version: number | null;
          model_pref: string | null;
          timezone: string | null;
          monthly_token_cap: number | null;
        }
      | undefined;

    let nextAnthropic: string | null;
    let nextAnthropicVersion: number | null;
    if (input.anthropic_key === undefined) {
      nextAnthropic = existing?.anthropic_key ?? null;
      nextAnthropicVersion = existing?.anthropic_key_version ?? null;
    } else if (input.anthropic_key === null) {
      nextAnthropic = null;
      nextAnthropicVersion = null;
    } else {
      nextAnthropic = encrypt(input.anthropic_key);
      nextAnthropicVersion = CURRENT_KEY_VERSION;
    }

    const nextModel =
      input.model_pref === undefined ? existing?.model_pref ?? null : input.model_pref;
    const nextTz =
      input.timezone === undefined ? existing?.timezone ?? null : input.timezone;
    const nextCap =
      input.monthly_token_cap === undefined
        ? existing?.monthly_token_cap ?? null
        : input.monthly_token_cap;

    db.prepare(
      `
      INSERT INTO user_settings (
        user_id, anthropic_key, anthropic_key_version, model_pref, timezone,
        monthly_token_cap, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        anthropic_key = excluded.anthropic_key,
        anthropic_key_version = excluded.anthropic_key_version,
        model_pref = excluded.model_pref,
        timezone = excluded.timezone,
        monthly_token_cap = excluded.monthly_token_cap,
        updated_at = excluded.updated_at
      `
    ).run(
      input.user_id,
      nextAnthropic,
      nextAnthropicVersion,
      nextModel,
      nextTz,
      nextCap,
      new Date().toISOString()
    );
  } finally {
    db.close();
  }
}

/**
 * Delete the user_settings row. Returns the number of rows deleted (0 or 1).
 */
export function deleteUserSettings(user_id: number): number {
  const db = openWrite();
  if (!db) return 0;
  try {
    if (!hasTable(db, "user_settings")) return 0;
    const result = db
      .prepare("DELETE FROM user_settings WHERE user_id = ?")
      .run(user_id);
    return result.changes;
  } finally {
    db.close();
  }
}
