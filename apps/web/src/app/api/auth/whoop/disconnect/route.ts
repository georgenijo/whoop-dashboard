import { NextResponse } from "next/server";
import { clientId, clientSecret, requireAuth } from "@/lib/auth";
import { deleteIntegration, getIntegration } from "@/lib/db/integrations";
import {
  LEGACY_DEFAULT_USER_ID,
  cleanupRetiredLegacyUserIntegration,
} from "@/lib/db/legacy-user-cleanup";
import { forModule } from "@/lib/logger";

const log = forModule("auth.whoop.disconnect");

export const dynamic = "force-dynamic";

const WHOOP_PROVIDER = "whoop";
const WHOOP_REVOKE_URL = "https://api.prod.whoop.com/oauth/oauth2/revoke";

/**
 * POST /api/auth/whoop/disconnect — full Whoop credential nuke.
 *
 * Three-step disconnect (issues #313 + #330 + #595):
 *   1. Best-effort revoke the stored refresh_token at Whoop. Failure is
 *      logged but never blocks the local cleanup — Whoop revocation matters
 *      for "stop a leaked token from refreshing", not for the user's
 *      perceived state.
 *   2. Delete the integrations row for the signed-in user. This is the ONLY
 *      row the request is authorized to delete.
 *   3. Run the one-shot `app_settings`-guarded cleanup of the retired
 *      bootstrap id (user_id=1), which is a no-op unless that row has no
 *      Apple identity and no session. Never a cross-user delete.
 *
 * Idempotent: second call returns the same shape with `removed: false`. The
 * tokens.json file fallback was removed in #330, so the integrations row IS
 * the full nuke now.
 */
export async function POST(req: Request) {
  const auth = await requireAuth(req);

  // Step 1: best-effort Whoop server-side revocation.
  // Capture the refresh_token BEFORE deleting the row. If revocation fails
  // we still proceed with the local delete — a stale token at Whoop is the
  // lesser evil compared to leaving the user "connected" locally.
  let revoked: boolean | null = null;
  let revokeError: string | null = null;
  try {
    const integration = getIntegration(auth.user.id, WHOOP_PROVIDER);
    if (integration?.refresh_token) {
      revoked = await revokeWhoopToken(integration.refresh_token);
    }
  } catch (err) {
    revokeError = err instanceof Error ? err.message : String(err);
    log.error({ user_id: auth.user.id, err: revokeError }, "revoke error");
  }

  // Step 2: delete ONLY the signed-in user's integrations row.
  let dbRemoved = false;
  try {
    dbRemoved = deleteIntegration(auth.user.id, WHOOP_PROVIDER) > 0;
  } catch (err) {
    log.error(
      { user_id: auth.user.id, err: err instanceof Error ? err.message : String(err) },
      "integrations delete failed",
    );
  }

  // Step 3: one-shot, guarded cleanup of the retired bootstrap id. It never
  // touches a real account: a uid=1 row with an Apple identity or a session
  // is left alone, and the app_settings marker prevents repeat evaluation.
  let legacyRemoved = false;
  if (auth.user.id !== LEGACY_DEFAULT_USER_ID) {
    try {
      const cleanup = cleanupRetiredLegacyUserIntegration();
      legacyRemoved = cleanup.removed;
      log.info(
        { user_id: auth.user.id, legacy_cleanup: cleanup.reason },
        "legacy user cleanup evaluated",
      );
    } catch (err) {
      log.error(
        {
          user_id: auth.user.id,
          err: err instanceof Error ? err.message : String(err),
        },
        "legacy user cleanup failed",
      );
    }
  }

  log.info(
    { user_id: auth.user.id, dbRemoved, legacyRemoved, revoked, revokeError },
    "disconnect complete",
  );

  return NextResponse.json({
    ok: true,
    removed: dbRemoved || legacyRemoved,
    db_removed: dbRemoved,
    legacy_removed: legacyRemoved,
    revoked,
    revoke_error: revokeError,
  });
}

/**
 * Revoke a Whoop refresh_token via the OAuth2 revoke endpoint.
 *
 * Returns:
 *   - true  → Whoop responded 2xx (token is now invalid server-side).
 *   - false → Whoop responded non-2xx, OR the network/timeout failed.
 *
 * Never throws. Per RFC 7009, an unknown token returns 200 OK from
 * compliant servers, so a 200 doesn't strictly prove the token was active
 * — but it does prove the request was acknowledged. Hard-cap at 5s so a
 * Whoop outage can't stall the disconnect button.
 */
async function revokeWhoopToken(refreshToken: string): Promise<boolean> {
  const basic = Buffer.from(`${clientId()}:${clientSecret()}`).toString(
    "base64"
  );
  const body = new URLSearchParams({
    token: refreshToken,
    token_type_hint: "refresh_token",
  });
  try {
    const resp = await fetch(WHOOP_REVOKE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) {
      log.warn({ status: resp.status }, "revoke non-2xx");
      return false;
    }
    return true;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "revoke fetch failed",
    );
    return false;
  }
}
