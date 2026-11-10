import "server-only";
import { hasTable, safeQuery } from "./connection";
import { getUserById } from "./auth";
import { deleteIntegration } from "./integrations";
import { getSetting, setSetting } from "./settings";

/**
 * id=1 is the pre-SIWA bootstrap placeholder. Phase D assigned every legacy
 * domain row to it, and `scripts/migrate-uid1-to-uid2.ts` later moved those
 * rows to the maintainer's SIWA id — but that one-shot migration only covered
 * domain tables, never `integrations`. A leftover uid=1 Whoop row therefore
 * keeps getting refreshed by the keepalive loop even though no session or
 * Apple identity can ever resolve to that account again.
 *
 * This cleanup is deliberately narrower than the removed cross-user delete:
 * it is one-shot (`app_settings`-guarded) and only touches uid=1 when that
 * row has NO Apple identity and NO session, i.e. when it provably cannot be
 * a real signed-in account. A real uid=1 (first user on a fresh DB) always
 * has `apple_sub`, so it is left alone forever.
 */
export const LEGACY_DEFAULT_USER_ID = 1;

/** app_settings marker so the cleanup runs at most once per database. */
const CLEANUP_SETTING_KEY = "legacy_uid1_whoop_integration_cleanup_v1";

export type LegacyCleanupReason =
  | "already_done"
  | "no_user"
  | "apple_identity"
  | "active_session"
  | "removed"
  | "absent";

export type LegacyCleanupResult = {
  attempted: boolean;
  removed: boolean;
  reason: LegacyCleanupReason;
};

function userHasSessions(userId: number): boolean {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "sessions")) return false;
      const row = db
        .prepare("SELECT 1 AS one FROM sessions WHERE user_id = ? LIMIT 1")
        .get(userId) as { one: number } | undefined;
      return !!row;
    }) ?? false
  );
}

/**
 * Delete the retired uid=1 Whoop integration once, when uid=1 is provably not
 * a real account. Safe to call on every disconnect: after the first run the
 * `app_settings` marker short-circuits it.
 *
 * Every non-cleanup outcome also writes the marker. Presence of an Apple
 * identity or a session means uid=1 is (or was) a real account, so the
 * decision must never be revisited later when a session happens to expire.
 */
export function cleanupRetiredLegacyUserIntegration(): LegacyCleanupResult {
  if (getSetting(CLEANUP_SETTING_KEY) === "done") {
    return { attempted: false, removed: false, reason: "already_done" };
  }

  const legacyUser = getUserById(LEGACY_DEFAULT_USER_ID);
  if (!legacyUser) {
    setSetting(CLEANUP_SETTING_KEY, "done");
    return { attempted: false, removed: false, reason: "no_user" };
  }

  if (legacyUser.apple_sub) {
    setSetting(CLEANUP_SETTING_KEY, "done");
    return { attempted: false, removed: false, reason: "apple_identity" };
  }

  if (userHasSessions(LEGACY_DEFAULT_USER_ID)) {
    setSetting(CLEANUP_SETTING_KEY, "done");
    return { attempted: false, removed: false, reason: "active_session" };
  }

  const removed =
    deleteIntegration(LEGACY_DEFAULT_USER_ID, "whoop") > 0;
  setSetting(CLEANUP_SETTING_KEY, "done");
  return {
    attempted: true,
    removed,
    reason: removed ? "removed" : "absent",
  };
}
