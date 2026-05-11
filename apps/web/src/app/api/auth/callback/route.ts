import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/auth";
import { publicOrigin } from "@/lib/auth/origin";
import { decodeWhoopOAuthState } from "@/lib/whoop/oauth-state";

export const dynamic = "force-dynamic";

const STATE_COOKIE_NAME = "whoop_oauth_state";
const STATE_COOKIE_PATH = "/api/auth/callback";

/** Short error codes surfaced to /settings via the `whoop_error=` query
 * param. Kept generic on purpose — no token material, no auth-internals. */
type SettingsErrorCode =
  | "state_missing"
  | "state_mismatch"
  | "state_invalid"
  | "exchange_failed";

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

/** Constant-time byte-equality on two strings. Avoids leaking the cookie
 * length through string comparison early-exit. */
function timingSafeStrEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const stateFromUrl = req.nextUrl.searchParams.get("state");

  if (error) {
    return redirectWithError(req, "exchange_failed");
  }
  if (!code) {
    return new NextResponse("Missing authorization code", { status: 400 });
  }

  // State verification — three checks, all required before we trust user_id:
  //   1. URL ↔ cookie byte-equality (cheap CSRF gate — a forged URL state
  //      from a different origin won't carry our cookie).
  //   2. HMAC-SHA256 verify against WHOOP_STATE_SECRET (integrity).
  //   3. Expiry (encoded payload carries `e`, TTL 5 min).
  const stateCookie = req.cookies.get(STATE_COOKIE_NAME)?.value ?? null;
  if (!stateFromUrl || !stateCookie) {
    return redirectWithError(req, "state_missing");
  }
  if (!timingSafeStrEq(stateFromUrl, stateCookie)) {
    return redirectWithError(req, "state_mismatch");
  }
  const decoded = decodeWhoopOAuthState(stateFromUrl);
  if (!decoded) {
    return redirectWithError(req, "state_invalid");
  }

  try {
    await exchangeCode(decoded.user_id, code);
  } catch (err) {
    // Keep the user-visible message generic. Real reason goes to logs.
    console.error("[auth/callback] exchange_failed", {
      user_id: decoded.user_id,
      error: err instanceof Error ? err.message : String(err),
    });
    return redirectWithError(req, "exchange_failed");
  }

  const response = NextResponse.redirect(new URL("/", publicOrigin(req)));
  clearStateCookie(response);
  return response;
}
