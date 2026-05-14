import { NextResponse } from "next/server";
import { clientId, clientSecret, requireAuth } from "@/lib/auth";
import { deleteIntegration, getIntegration } from "@/lib/db/integrations";

export const dynamic = "force-dynamic";

const WHOOP_PROVIDER = "whoop";
const WHOOP_REVOKE_URL = "https://api.prod.whoop.com/oauth/oauth2/revoke";
// Legacy maintainer/bootstrap user id. Pre-Phase-D + pre-SIWA installs landed
// tokens here regardless of which Apple sub signed in (#313 root cause). On
// disconnect we wipe both the signed-in user's row AND this one so a stale
// row from the legacy world can't keep syncing in the background.
const LEGACY_DEFAULT_USER_ID = 1;

/**
 * POST /api/auth/whoop/disconnect — full Whoop credential nuke.
 *
 * Three-step disconnect (issues #313 + #330):
 *   1. Best-effort revoke the stored refresh_token at Whoop. Failure is
 *      logged but never blocks the local cleanup — Whoop revocation matters
 *      for "stop a leaked token from refreshing", not for the user's
 *      perceived state.
 *   2. Delete the integrations row for the signed-in user.
 *   3. Delete any stale row at user_id=1 (the legacy bootstrap id) for
 *      hygiene — pre-SIWA installs may have written tokens there even when
 *      the active session is user_id=2.
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
    console.error(`[whoop/disconnect] revoke error: ${revokeError}`);
  }

  // Step 2 + 3: delete integrations row for signed-in user AND the legacy
  // user_id=1 row (if it's not the same user already).
  let dbRemoved = false;
  let legacyRemoved = false;
  try {
    dbRemoved = deleteIntegration(auth.user.id, WHOOP_PROVIDER) > 0;
  } catch (err) {
    console.error(
      `[whoop/disconnect] integrations delete failed user_id=${auth.user.id}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  if (auth.user.id !== LEGACY_DEFAULT_USER_ID) {
    try {
      legacyRemoved =
        deleteIntegration(LEGACY_DEFAULT_USER_ID, WHOOP_PROVIDER) > 0;
    } catch (err) {
      console.error(
        `[whoop/disconnect] legacy integrations delete failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  console.info(
    `[whoop/disconnect] user_id=${auth.user.id} dbRemoved=${dbRemoved} legacyRemoved=${legacyRemoved} revoked=${revoked} revokeError=${revokeError}`
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
      console.warn(
        `[whoop/disconnect] revoke non-2xx status=${resp.status}`
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      `[whoop/disconnect] revoke fetch failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return false;
  }
}
