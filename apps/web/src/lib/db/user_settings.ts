import "server-only";
// Per-user application preferences. Single row per user, lazy-created on
// first upsert. Mirrors the `integrations` table's encryption strategy:
// Provider API keys are symmetric-encrypted with VAULT_KEY (NaCl secretbox)
// and tagged with a key-version column so future rotations don't silently
// produce undecryptable garbage.
//
// NULL provider keys are meaningful: they mean "use server fallback" (BYOK
// opt-out). A row may exist with both keys NULL and model_pref set.

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
  cursor_key: string | null;
  model_pref: string | null;
  coach_effort: string | null;
  timezone: string | null;
  monthly_token_cap: number | null;
  coach_goals: string[] | null;
  onboarded_at: string | null;
  tz: string | null;
  updated_at: string;
};

export type UserSettingsInput = {
  user_id: number;
  // `undefined` = leave existing column untouched. `null` = clear the column.
  anthropic_key?: string | null;
  cursor_key?: string | null;
  model_pref?: string | null;
  coach_effort?: string | null;
  timezone?: string | null;
  monthly_token_cap?: number | null;
  coach_goals?: string[] | null;
  onboarded_at?: string | null;
  tz?: string | null;
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
  // helpers stay self-contained. The three Phase E.1 columns (coach_goals,
  // onboarded_at, tz) are included here so tests using their own DB without
  // openWrite() see the same shape as production.
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      anthropic_key TEXT,
      anthropic_key_version INTEGER,
      cursor_key TEXT,
      cursor_key_version INTEGER,
      model_pref TEXT,
      coach_effort TEXT,
      timezone TEXT,
      monthly_token_cap INTEGER,
      coach_goals TEXT,
      onboarded_at TEXT,
      tz TEXT,
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
  cursor_key: string | null;
  cursor_key_version: number | null;
  model_pref: string | null;
  coach_effort: string | null;
  timezone: string | null;
  monthly_token_cap: number | null;
  coach_goals: string | null;
  onboarded_at: string | null;
  tz: string | null;
  updated_at: string;
};

/**
 * Returns the user's settings row with provider keys decrypted, or null if no
 * row exists for this user_id.
 *
 * A provider key is returned as null if its decryption fails (missing/wrong
 * VAULT_KEY, unsupported key_version, tampered ciphertext). Other columns and
 * independently valid keys still surface. Errors are logged server-side.
 */
export function getUserSettings(user_id: number): UserSettings | null {
  const db = openWrite();
  if (!db) return null;
  try {
    if (!hasTable(db, "user_settings")) return null;
    const row = db
      .prepare(
        `
        SELECT user_id, anthropic_key, anthropic_key_version, cursor_key,
               cursor_key_version, model_pref, coach_effort, timezone, monthly_token_cap,
               coach_goals, onboarded_at, tz, updated_at
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

    let decryptedCursor: string | null = null;
    if (row.cursor_key !== null) {
      try {
        assertKeyVersionSupported(row.cursor_key_version ?? 0);
        decryptedCursor = decrypt(row.cursor_key);
      } catch (err) {
        if (
          err instanceof VaultDecryptError ||
          err instanceof VaultMissingKeyError
        ) {
          console.error(
            `[user_settings] cursor_key decrypt failed for user_id=${user_id}: ${err.message}`
          );
          decryptedCursor = null;
        } else {
          throw err;
        }
      }
    }

    // coach_goals is stored as JSON TEXT (e.g. `["sleep_better","train_smarter"]`).
    // Treat malformed-on-disk as "no preferences" — UI continues to render and
    // the user can re-pick goals from Settings. Defensive shape check: we only
    // accept an array of strings; anything else (object, mixed types) gets
    // dropped to null with a console.error.
    let parsedGoals: string[] | null = null;
    if (row.coach_goals !== null) {
      try {
        const decoded: unknown = JSON.parse(row.coach_goals);
        if (
          Array.isArray(decoded) &&
          decoded.every((v): v is string => typeof v === "string")
        ) {
          parsedGoals = decoded;
        } else {
          console.error(
            `[user_settings] coach_goals shape invalid for user_id=${user_id}`
          );
        }
      } catch (err) {
        console.error(
          `[user_settings] coach_goals JSON parse failed for user_id=${user_id}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    return {
      user_id: row.user_id,
      anthropic_key: decryptedAnthropic,
      cursor_key: decryptedCursor,
      model_pref: row.model_pref,
      coach_effort: row.coach_effort,
      timezone: row.timezone,
      monthly_token_cap: row.monthly_token_cap,
      coach_goals: parsedGoals,
      onboarded_at: row.onboarded_at,
      tz: row.tz,
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
 * `anthropic_key` / `cursor_key`:
 *   - `undefined` → leave the column unchanged
 *   - `null`      → clear the column (and key_version)
 *   - string      → encrypt with VAULT_KEY and store ciphertext + key_version
 *
 * Throws:
 *   - VaultMissingKeyError if a provider key is a string but VAULT_KEY is unset
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
        SELECT anthropic_key, anthropic_key_version, cursor_key,
               cursor_key_version, model_pref, coach_effort, timezone, monthly_token_cap,
               coach_goals, onboarded_at, tz
        FROM user_settings
        WHERE user_id = ?
        `
      )
      .get(input.user_id) as
      | {
          anthropic_key: string | null;
          anthropic_key_version: number | null;
          cursor_key: string | null;
          cursor_key_version: number | null;
          model_pref: string | null;
          coach_effort: string | null;
          timezone: string | null;
          monthly_token_cap: number | null;
          coach_goals: string | null;
          onboarded_at: string | null;
          tz: string | null;
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

    let nextCursor: string | null;
    let nextCursorVersion: number | null;
    if (input.cursor_key === undefined) {
      nextCursor = existing?.cursor_key ?? null;
      nextCursorVersion = existing?.cursor_key_version ?? null;
    } else if (input.cursor_key === null) {
      nextCursor = null;
      nextCursorVersion = null;
    } else {
      nextCursor = encrypt(input.cursor_key);
      nextCursorVersion = CURRENT_KEY_VERSION;
    }

    const nextModel =
      input.model_pref === undefined ? existing?.model_pref ?? null : input.model_pref;
    const nextCoachEffort =
      input.coach_effort === undefined
        ? existing?.coach_effort ?? null
        : input.coach_effort;
    const nextTz =
      input.timezone === undefined ? existing?.timezone ?? null : input.timezone;
    const nextCap =
      input.monthly_token_cap === undefined
        ? existing?.monthly_token_cap ?? null
        : input.monthly_token_cap;
    let nextCoachGoals: string | null;
    if (input.coach_goals === undefined) {
      nextCoachGoals = existing?.coach_goals ?? null;
    } else if (input.coach_goals === null) {
      nextCoachGoals = null;
    } else {
      nextCoachGoals = JSON.stringify(input.coach_goals);
    }
    const nextOnboardedAt =
      input.onboarded_at === undefined
        ? existing?.onboarded_at ?? null
        : input.onboarded_at;
    const nextTzCol =
      input.tz === undefined ? existing?.tz ?? null : input.tz;

    db.prepare(
      `
      INSERT INTO user_settings (
        user_id, anthropic_key, anthropic_key_version, cursor_key,
        cursor_key_version, model_pref, coach_effort, timezone, monthly_token_cap,
        coach_goals, onboarded_at, tz, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        anthropic_key = excluded.anthropic_key,
        anthropic_key_version = excluded.anthropic_key_version,
        cursor_key = excluded.cursor_key,
        cursor_key_version = excluded.cursor_key_version,
        model_pref = excluded.model_pref,
        coach_effort = excluded.coach_effort,
        timezone = excluded.timezone,
        monthly_token_cap = excluded.monthly_token_cap,
        coach_goals = excluded.coach_goals,
        onboarded_at = excluded.onboarded_at,
        tz = excluded.tz,
        updated_at = excluded.updated_at
      `
    ).run(
      input.user_id,
      nextAnthropic,
      nextAnthropicVersion,
      nextCursor,
      nextCursorVersion,
      nextModel,
      nextCoachEffort,
      nextTz,
      nextCap,
      nextCoachGoals,
      nextOnboardedAt,
      nextTzCol,
      new Date().toISOString()
    );
  } finally {
    db.close();
  }
}

/**
 * Replace the user's coach_goals list. Pass `null` to clear it (BYOK opt-out
 * style). Empty array `[]` means "no goals selected" and is persisted as the
 * JSON literal `[]` — distinct from `null`, so the wizard can record an
 * explicit "I skipped this" decision.
 */
export function setCoachGoals(user_id: number, goals: string[] | null): void {
  upsertUserSettings({ user_id, coach_goals: goals });
}

/**
 * Set-once stamp. Returns the persisted `onboarded_at` — either the existing
 * value (if already populated) or the new one (if first-time write).
 *
 * Implemented as a single INSERT … ON CONFLICT DO UPDATE … RETURNING so the
 * read-and-write is one atomic statement, not a TOCTOU read-then-write. Two
 * concurrent callers therefore both observe the same returned ISO string —
 * whichever statement ran first wins, the second sees its persisted value via
 * COALESCE. RETURNING is SQLite 3.35+ and supported by better-sqlite3.
 */
export function markOnboarded(user_id: number, now: Date = new Date()): string {
  const iso = now.toISOString();
  const db = openWrite();
  if (!db) throw new Error("DB unavailable");
  try {
    ensureUserSettingsTable(db);
    if (!userExists(db, user_id)) {
      throw new UserSettingsUserMissingError(user_id);
    }
    const row = db
      .prepare(
        `
        INSERT INTO user_settings (user_id, onboarded_at, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          onboarded_at = COALESCE(user_settings.onboarded_at, excluded.onboarded_at),
          updated_at = CASE
            WHEN user_settings.onboarded_at IS NULL THEN excluded.updated_at
            ELSE user_settings.updated_at
          END
        RETURNING onboarded_at
        `
      )
      .get(user_id, iso, iso) as { onboarded_at: string };
    return row.onboarded_at;
  } finally {
    db.close();
  }
}

/**
 * Write-once IANA timezone. Bespoke SQL (not upsertUserSettings) because the
 * "don't overwrite an existing tz" guard belongs at the SQL level — UPDATE …
 * WHERE tz IS NULL is atomic and avoids a read-then-write race on concurrent
 * /api/me/tz hits from multiple tabs. Returns `true` iff this call wrote a
 * value (changes === 1); `false` means a value was already present.
 */
export function setTzIfUnset(user_id: number, tz: string): boolean {
  const db = openWrite();
  if (!db) throw new Error("DB unavailable");
  try {
    ensureUserSettingsTable(db);
    if (!userExists(db, user_id)) {
      throw new UserSettingsUserMissingError(user_id);
    }
    const now = new Date().toISOString();
    // Two-step is intentional: INSERT OR IGNORE materialises a row if one
    // doesn't exist yet (apple_sub users may have no user_settings row), then
    // the UPDATE … WHERE tz IS NULL is the atomic write-once gate. Both run
    // inside an implicit transaction (single statement each) — no explicit
    // BEGIN needed because better-sqlite3 prepared statements are sync.
    db.prepare(
      "INSERT OR IGNORE INTO user_settings (user_id, updated_at) VALUES (?, ?)"
    ).run(user_id, now);
    const result = db
      .prepare(
        "UPDATE user_settings SET tz = ?, updated_at = ? WHERE user_id = ? AND tz IS NULL"
      )
      .run(tz, now, user_id);
    return result.changes === 1;
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
