import "server-only";
// APNs (and future Android) device-token registry.
//
// Storage shape: composite PK on (user_id, token) plus a UNIQUE INDEX on
// `token` alone. The unique index is what lets `upsertDeviceToken` detect a
// device that has been re-bound to a different user (e.g. a phone changed
// hands) and atomically re-home the row to the new user via
// `INSERT … ON CONFLICT(token) DO UPDATE`. Without the standalone unique
// index, the same physical device would silently end up receiving pushes
// for multiple accounts.

import { hasTable, openWrite, safeQuery } from "./connection";

export type Platform = "ios";
export type Environment = "development" | "production";

export type DeviceToken = {
  user_id: number;
  token: string;
  platform: Platform;
  env: Environment;
  app_version: string | null;
  created_at: string;
  updated_at: string;
};

export type DeviceTokenInput = {
  user_id: number;
  token: string;
  platform: Platform;
  env: Environment;
  app_version?: string | null;
};

/**
 * Insert or update a device token. Atomic on the (token) unique index:
 *
 *   - First registration for a (user, token) → INSERT.
 *   - Same user re-registers the same token (token rotation no-op) → UPDATE
 *     with refreshed updated_at.
 *   - Different user registers a token already owned by another user (device
 *     handed off, sign-out + sign-in as different account) → ON CONFLICT
 *     rewrites the row's user_id, preserving the original created_at so the
 *     old owner stops receiving pushes the moment the new owner registers.
 *
 * Returns the resulting row.
 */
export function upsertDeviceToken(input: DeviceTokenInput): DeviceToken {
  const db = openWrite();
  if (!db) throw new Error("DB unavailable");
  try {
    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO device_tokens (
        user_id, token, platform, env, app_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(token) DO UPDATE SET
        user_id = excluded.user_id,
        platform = excluded.platform,
        env = excluded.env,
        app_version = excluded.app_version,
        updated_at = excluded.updated_at
      `
    ).run(
      input.user_id,
      input.token,
      input.platform,
      input.env,
      input.app_version ?? null,
      now,
      now
    );
    const row = db
      .prepare(
        "SELECT user_id, token, platform, env, app_version, created_at, updated_at FROM device_tokens WHERE token = ?"
      )
      .get(input.token) as DeviceToken | undefined;
    if (!row) throw new Error("upsertDeviceToken: row vanished after upsert");
    return row;
  } finally {
    db.close();
  }
}

/**
 * Returns all device tokens currently registered to `user_id`. Empty array
 * when the table doesn't exist (cold DB) or the user has no tokens.
 */
export function listDeviceTokensForUser(user_id: number): DeviceToken[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "device_tokens")) return [];
      return db
        .prepare(
          "SELECT user_id, token, platform, env, app_version, created_at, updated_at FROM device_tokens WHERE user_id = ? ORDER BY updated_at DESC"
        )
        .all(user_id) as DeviceToken[];
    }) ?? []
  );
}

/**
 * Delete a single (user, token) row. Returns the number of rows deleted
 * (0 or 1). Used after APNs returns 410 Unregistered on a token.
 */
export function deleteDeviceToken(user_id: number, token: string): number {
  const db = openWrite();
  if (!db) return 0;
  try {
    if (!hasTable(db, "device_tokens")) return 0;
    const result = db
      .prepare("DELETE FROM device_tokens WHERE user_id = ? AND token = ?")
      .run(user_id, token);
    return result.changes;
  } finally {
    db.close();
  }
}
