import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { exchangeCode } from "@/lib/auth";
import { publicOrigin } from "@/lib/auth/origin";
import { getUserSettings } from "@/lib/db";
import { setProviderUserId } from "@/lib/db/integrations";
import { getWhoopProfile } from "@/lib/whoop/client";
import { decodeWhoopOAuthState } from "@/lib/whoop/oauth-state";

export const dynamic = "force-dynamic";

const STATE_COOKIE_NAME = "whoop_oauth_state";
const STATE_COOKIE_PATH = "/api/auth/callback";

/**
 * Custom scheme the iOS app's ASWebAuthenticationSession listens for. When
 * the callback completes for an iOS-initiated flow we redirect here so
 * the OS-managed in-app browser dismisses and fires the completion
 * handler. The host (`oauth-complete`) and `status=` query param are the
 * only contract the iOS side reads — keep stable.
 */
const IOS_CALLBACK_SCHEME = "coach";
const IOS_CALLBACK_HOST = "oauth-complete";

/** Short error codes surfaced to /settings via the `whoop_error=` query
 * param. Kept generic on purpose — no token material, no auth-internals. */
type SettingsErrorCode =
  | "state_missing"
  | "state_mismatch"
  | "state_invalid"
  | "user_cancelled"
  | "exchange_failed";

function iosCallbackURL(status: "ok" | "error", code?: SettingsErrorCode): string {
  const params = new URLSearchParams({ status });
  if (code) params.set("code", code);
  return `${IOS_CALLBACK_SCHEME}://${IOS_CALLBACK_HOST}?${params.toString()}`;
}

/**
 * Build a response that redirects to /settings with a short error code,
 * and clears the OAuth state cookie. Used for every failure path so the
 * cookie never lingers past one round-trip.
 */
function redirectWithError(req: NextRequest, code: SettingsErrorCode): NextResponse {
  const url = new URL("/settings", publicOrigin(req));
  url.searchParams.set("whoop_error", code);
  const response = NextResponse.redirect(url);
  response.cookies.set({
    name: STATE_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: STATE_COOKIE_PATH,
    maxAge: 0,
  });
  return response;
}

function clearStateCookie(response: NextResponse) {
  response.cookies.set({
    name: STATE_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: STATE_COOKIE_PATH,
    maxAge: 0,
  });
}

/** Constant-time byte-equality on two strings via `crypto.timingSafeEqual`.
 * The function throws on unequal-length buffers, so length-check first. */
function timingSafeStrEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const stateFromUrl = req.nextUrl.searchParams.get("state");

  // Decode the signed state up front so we can route iOS-flow errors back
  // to the custom scheme instead of /settings (the in-app browser can't
  // render Next pages cleanly and the user would be stranded).
  const decoded = stateFromUrl ? decodeWhoopOAuthState(stateFromUrl) : null;
  const isIosFlow = decoded?.flow === "ios";

  if (error) {
    // Whoop's OAuth2 spec returns `access_denied` when the user clicks Cancel
    // on the authorize screen. Surface that as a distinct UX state — not an
    // "exchange_failed" technical error.
    const errCode: SettingsErrorCode =
      error === "access_denied" ? "user_cancelled" : "exchange_failed";
    return isIosFlow
      ? NextResponse.redirect(iosCallbackURL("error", errCode))
      : redirectWithError(req, errCode);
  }
  if (!code) {
    return new NextResponse("Missing authorization code", { status: 400 });
  }

  // State verification — three checks, all required before we trust user_id:
  //   1. URL ↔ cookie byte-equality (cheap CSRF gate — a forged URL state
  //      from a different origin won't carry our cookie). SKIPPED for the
  //      iOS flow: ASWebAuthenticationSession uses an ephemeral cookie jar
  //      with no path back to the user's web session, so there's no cookie
  //      to compare. CSRF doesn't apply — an attacker can't trigger an
  //      OAuth handshake from an iOS device they don't control.
  //   2. HMAC-SHA256 verify against WHOOP_STATE_SECRET (integrity).
  //   3. Expiry (encoded payload carries `e`, TTL 5 min).
  if (!stateFromUrl) {
    return isIosFlow
      ? NextResponse.redirect(iosCallbackURL("error", "state_missing"))
      : redirectWithError(req, "state_missing");
  }
  if (!isIosFlow) {
    const stateCookie = req.cookies.get(STATE_COOKIE_NAME)?.value ?? null;
    if (!stateCookie) {
      return redirectWithError(req, "state_missing");
    }
    if (!timingSafeStrEq(stateFromUrl, stateCookie)) {
      return redirectWithError(req, "state_mismatch");
    }
  }
  if (!decoded) {
    return isIosFlow
      ? NextResponse.redirect(iosCallbackURL("error", "state_invalid"))
      : redirectWithError(req, "state_invalid");
  }

  try {
    await exchangeCode(decoded.user_id, code);
  } catch (err) {
    // Keep the user-visible message generic. Real reason goes to logs.
    console.error("[auth/callback] exchange_failed", {
      user_id: decoded.user_id,
      error: err instanceof Error ? err.message : String(err),
    });
    return isIosFlow
      ? NextResponse.redirect(iosCallbackURL("error", "exchange_failed"))
      : redirectWithError(req, "exchange_failed");
  }

  // Phase D — capture the remote Whoop user_id so webhook events for this
  // user route to the right local tenant. We wrap in try/catch because a
  // profile-fetch failure (Whoop 5xx, network blip) MUST NOT fail the OAuth
  // flow: the lazy backfill in runWhoopSync will retry on the user's next
  // sync. The mapping is recoverable; a failed OAuth is not.
  try {
    const profile = await getWhoopProfile({ userId: decoded.user_id });
    if (profile?.user_id != null) {
      setProviderUserId(decoded.user_id, "whoop", String(profile.user_id));
    }
  } catch (err) {
    console.warn("[auth/callback] provider_user_id capture failed", {
      user_id: decoded.user_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // iOS flow ends here — bounce to the custom scheme so
  // ASWebAuthenticationSession dismisses and fires its completion handler.
  // No web destination logic and no state cookie to clear (iOS path never
  // set one).
  if (isIosFlow) {
    return NextResponse.redirect(iosCallbackURL("ok"));
  }

  // Phase E.1 — route un-onboarded users to /welcome?stage=sync so the
  // wizard's Screen 3 picks up where the OAuth handshake left off and runs
  // the initial 7-day sync. Already-onboarded users (re-auth flow) keep the
  // original "/" destination.
  const settings = getUserSettings(decoded.user_id);
  const dest =
    settings === null || settings.onboarded_at === null
      ? "/welcome?stage=sync"
      : "/";
  const response = NextResponse.redirect(new URL(dest, publicOrigin(req)));
  clearStateCookie(response);
  return response;
}
