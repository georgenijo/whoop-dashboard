import "server-only";
// Encrypted credentials storage for OAuth providers (Whoop today, more later).
//
// Convention:
//   - DB column for OAuth scopes is named `scopes` (plural).
//   - Public API key on the integration object is `scope` (singular), to
//     match the Whoop OAuth response shape.
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
  needs_reauth: boolean;
  provider_user_id: string | null;
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
      needs_reauth INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, provider)
    );
  `);
  // Lazy ALTERs for rows that pre-dated key_version / needs_reauth.
  const cols = db.prepare("PRAGMA table_info(integrations)").all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === "key_version")) {
    db.exec(
      "ALTER TABLE integrations ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1"
    );
  }
  if (!cols.some((c) => c.name === "needs_reauth")) {
    db.exec(
      "ALTER TABLE integrations ADD COLUMN needs_reauth INTEGER NOT NULL DEFAULT 0"
    );
  }
  if (!cols.some((c) => c.name === "provider_user_id")) {
    db.exec("ALTER TABLE integrations ADD COLUMN provider_user_id TEXT");
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_integrations_provider_user ON integrations(provider, provider_user_id)"
  );
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
    // Note: `provider_user_id` is intentionally NOT touched by this upsert.
    // Phase D: it's populated by setProviderUserId() in the OAuth callback
    // and lazy-backfilled from runWhoopSync. Token refresh flows pass through
    // here with no profile fetch, so writing NULL here would clobber a
    // previously-captured mapping. We rely on ON CONFLICT not mentioning the
    // column to preserve whatever's already there.
    db.prepare(
      `
      INSERT INTO integrations (
        user_id, provider, access_token, refresh_token, expires_at,
        scopes, token_type, raw, key_version, needs_reauth, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(user_id, provider) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        scopes = excluded.scopes,
        token_type = excluded.token_type,
        raw = excluded.raw,
        key_version = excluded.key_version,
        needs_reauth = 0,
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
  needs_reauth: number;
  provider_user_id: string | null;
  updated_at: string;
};

/**
 * Returns true iff a row exists for (user_id, provider). Does NOT decrypt.
 *
 * Use this to distinguish "no row at all" from "row exists but decrypt
 * failed" without paying the vault round-trip — useful in tests and in any
 * future diagnostic path. Production token reads go through `getIntegration`
 * (which returns null on either "no row" or "decrypt failed").
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
 * Every local user_id that has an integration row for `provider`, ascending.
 * Read-only, no decrypt — used to fan a provider-wide operation (e.g. the
 * refresh-only keepalive, #273) out across every tenant without guessing at
 * a fixed user_id. Multi-tenant since Phase D; this must never hardcode
 * user 1.
 *
 * `activeOnly: true` excludes rows already flagged `needs_reauth = 1`. A
 * tenant whose grant is already known-dead gains nothing from another
 * refresh attempt — the flag can only be cleared by the user reconnecting,
 * not by hammering a doomed refresh_token — so the keepalive route passes
 * this to avoid 48 guaranteed-to-fail Whoop POSTs/day per dead tenant.
 */
export function listIntegrationUserIds(
  provider: string,
  opts: { activeOnly?: boolean } = {}
): number[] {
  const db = open();
  if (!db) return [];
  try {
    if (!hasTable(db, "integrations")) return [];
    const reauthClause = opts.activeOnly ? " AND needs_reauth = 0" : "";
    const rows = db
      .prepare(
        `SELECT user_id FROM integrations WHERE provider = ?${reauthClause} ORDER BY user_id ASC`
      )
      .all(provider) as { user_id: number }[];
    return rows.map((r) => r.user_id);
  } finally {
    db.close();
  }
}

export type IntegrationStatus = { exists: boolean; needs_reauth: boolean };

/**
 * Read-only status partition for the overview-page nudge banners.
 *
 * Cheap by design: opens the DB read-only (no lazy ALTERs, no decrypt) and
 * returns just enough to choose between three banners ("not set up",
 * "needs reconnect", "fine"). Defensive on pre-Phase-A snapshots where the
 * `needs_reauth` column may not yet have been added — falls back to
 * `needs_reauth: false` rather than throwing.
 *
 * Note: `integrations` is intentionally NOT a domain table (no recovery /
 * sleep / strain / workouts data), so tenant safety is enforced inline via
 * `WHERE user_id = ? AND provider = ?` rather than the scoped wrapper.
 */
export function getIntegrationStatus(
  user_id: number,
  provider: string
): IntegrationStatus {
  const db = open();
  if (!db) return { exists: false, needs_reauth: false };
  try {
    if (!hasTable(db, "integrations")) {
      return { exists: false, needs_reauth: false };
    }
    const row = db
      .prepare(
        "SELECT needs_reauth FROM integrations WHERE user_id = ? AND provider = ?"
      )
      .get(user_id, provider) as { needs_reauth: number } | undefined;
    return { exists: !!row, needs_reauth: row?.needs_reauth === 1 };
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
               scopes, token_type, raw, key_version, needs_reauth,
               provider_user_id, updated_at
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
        needs_reauth: row.needs_reauth === 1,
        provider_user_id: row.provider_user_id,
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

/**
 * Set the `needs_reauth` flag for a (user, provider) row. Used by the Whoop
 * refresh-token path to mark the integration as requiring user-driven
 * reconnect when the refresh endpoint returns a definitive
 * credential-rejection (invalid_grant / invalid_token / 401).
 *
 * The flag is reset to 0 by upsertIntegration on every successful token
 * write, so a subsequent successful refresh OR fresh OAuth callback both
 * clear it without an explicit unset call.
 */
export function setIntegrationNeedsReauth(
  user_id: number,
  provider: string,
  value: boolean
): void {
  const db = openWrite();
  if (!db) return;
  try {
    if (!hasTable(db, "integrations")) return;
    db.prepare(
      "UPDATE integrations SET needs_reauth = ?, updated_at = ? WHERE user_id = ? AND provider = ?"
    ).run(value ? 1 : 0, new Date().toISOString(), user_id, provider);
  } finally {
    db.close();
  }
}

/**
 * Set `provider_user_id` for a (user, provider) row.
 *
 * Phase D — the remote provider's user id (Whoop's `evt.user_id` in webhook
 * payloads) is captured here so future webhooks for that remote id can be
 * routed to the right local users.id. Called from the OAuth callback after
 * a successful profile fetch, and lazy-backfilled from `runWhoopSync` if
 * still NULL.
 *
 * No-op when the integrations row doesn't exist — callers must `upsertIntegration`
 * first.
 */
export function setProviderUserId(
  user_id: number,
  provider: string,
  providerUserId: string
): void {
  const db = openWrite();
  if (!db) return;
  try {
    if (!hasTable(db, "integrations")) return;
    db.prepare(
      "UPDATE integrations SET provider_user_id = ?, updated_at = ? " +
        "WHERE user_id = ? AND provider = ?"
    ).run(providerUserId, new Date().toISOString(), user_id, provider);
  } finally {
    db.close();
  }
}

/**
 * Reverse-lookup: given a remote provider user id (e.g. Whoop's `evt.user_id`),
 * return our local users.id. Returns null when no integration row matches.
 *
 * Used by the webhook handler to route an inbound event to the right tenant
 * without falling back to a hardcoded user_id.
 */
export function lookupUserIdByProvider(
  provider: string,
  providerUserId: string
): number | null {
  const db = open();
  if (!db) return null;
  try {
    if (!hasTable(db, "integrations")) return null;
    const row = db
      .prepare(
        "SELECT user_id FROM integrations WHERE provider = ? AND provider_user_id = ? LIMIT 1"
      )
      .get(provider, providerUserId) as { user_id: number } | undefined;
    return row?.user_id ?? null;
  } finally {
    db.close();
  }
}

/**
 * Delete the (user, provider) integrations row. Returns the number of rows
 * deleted (0 or 1) so callers can report whether the action was a no-op
 * vs. an actual removal. Returns 0 when the DB is unavailable or the
 * integrations table doesn't exist — the desired end-state ("no row for
 * this pair") is satisfied either way, but the count is honest about
 * having done nothing.
 */
export function deleteIntegration(user_id: number, provider: string): number {
  const db = openWrite();
  if (!db) return 0;
  try {
    if (!hasTable(db, "integrations")) return 0;
    const result = db
      .prepare("DELETE FROM integrations WHERE user_id = ? AND provider = ?")
      .run(user_id, provider);
    return result.changes;
  } finally {
    db.close();
  }
}
