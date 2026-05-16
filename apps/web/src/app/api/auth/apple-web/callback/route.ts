import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import {
  AppleAuthError,
  verifyAppleIdentityToken,
} from "@/lib/auth/apple";
import {
  AppleWebConfigError,
  exchangeAppleAuthCode,
  loadAppleWebConfig,
} from "@/lib/auth/apple-web";
import { signSessionToken } from "@/lib/auth/jwt";
import { upsertUserByAppleSub } from "@/lib/db";
import {
  APPLE_OAUTH_STATE_COOKIE,
  COACH_SESSION_COOKIE,
  COACH_SESSION_MAX_AGE_SEC,
} from "@/lib/auth/cookies";
import {
  decodeAppleOAuthState,
  isSafeReturnPath,
} from "@/lib/auth/apple-state";
import { publicOrigin } from "@/lib/auth/origin";
import { forModule } from "@/lib/logger";

const log = forModule("auth.apple-web.callback");

export const dynamic = "force-dynamic";

// `callbackUrl` is the value sent to Apple as `redirect_uri` in the token
// exchange. It must EXACTLY match what `apple-web/start/route.ts` sent in
// the authorize step, so both routes derive it the same way:
// APPLE_REDIRECT_URI env → nextUrl-based fallback. This is distinct from
// the user-facing `publicOrigin(req)` used for browser-facing redirects.
function callbackUrl(req: NextRequest): string {
  const override = process.env.APPLE_REDIRECT_URI;
  if (override && override.trim()) return override.trim();
  // eslint-disable-next-line no-restricted-syntax -- third-party OAuth callback URI, not a redirect target
  return new URL("/api/auth/apple-web/callback", req.nextUrl.origin).toString();
}

function bail(req: NextRequest, reason: string, status = 400): NextResponse {
  // Send the user back to /signin with an error code rather than a raw 4xx —
  // they should see the page, not a JSON corpse. status= is preserved on
  // direct API testing because we mirror it onto the redirect.
  const url = new URL("/signin", publicOrigin(req));
  url.searchParams.set("error", reason);
  const res = NextResponse.redirect(url, { status: 303 });
  // Tear down the state cookie regardless — it's single-use.
  res.cookies.set({
    name: APPLE_OAUTH_STATE_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: 0,
  });
  res.headers.set("x-apple-web-error", reason);
  res.headers.set("x-apple-web-status", String(status));
  return res;
}

/**
 * Constant-time string compare. timingSafeEqual throws on length mismatch
 * — we early-out for that and return false, so a wrong-length attacker
 * input still leaks zero info beyond "wrong" via this branch.
 */
function safeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bail(req, "invalid_request", 400);
  }

  const code = form.get("code");
  const state = form.get("state");
  const error = form.get("error");

  if (typeof error === "string" && error) {
    return bail(req, `apple_${error}`, 400);
  }
  if (typeof code !== "string" || !code) {
    return bail(req, "missing_code", 400);
  }
  if (typeof state !== "string" || !state) {
    return bail(req, "missing_state", 400);
  }

  const cookieRaw = req.cookies.get(APPLE_OAUTH_STATE_COOKIE)?.value;
  // Split the two failure modes so the next #304 flake reveals which one
  // we're hitting. Previously both fell through as `state_cookie_missing`,
  // which made browser-policy drops indistinguishable from encoding drift.
  if (cookieRaw === undefined) {
    log.error({}, "state cookie absent on request");
    return bail(req, "state_cookie_missing", 400);
  }
  const cookiePayload = decodeAppleOAuthState(cookieRaw);
  if (!cookiePayload) {
    log.error(
      { cookie_length: cookieRaw.length },
      "state cookie present but failed to decode",
    );
    return bail(req, "state_cookie_invalid", 400);
  }
  if (!safeStringEqual(cookiePayload.state, state)) {
    return bail(req, "state_mismatch", 400);
  }

  let cfg;
  try {
    cfg = loadAppleWebConfig();
  } catch (err) {
    if (err instanceof AppleWebConfigError) {
      return bail(req, "apple_not_configured", 503);
    }
    throw err;
  }

  let tokenResp;
  try {
    tokenResp = await exchangeAppleAuthCode(code, callbackUrl(req), cfg);
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "token exchange failed",
    );
    return bail(req, "token_exchange_failed", 502);
  }

  let identity;
  try {
    identity = await verifyAppleIdentityToken(tokenResp.id_token, {
      audience: cfg.servicesId,
    });
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "id_token verify failed",
    );
    if (err instanceof AppleAuthError) {
      return bail(req, "id_token_invalid", 401);
    }
    throw err;
  }

  // Email is only present on first sign-in for this Apple sub. Persist
  // immediately so we never lose it.
  const user = upsertUserByAppleSub(identity.sub, identity.email);
  const { token } = await signSessionToken(user.id);

  // Honour `from` from the state cookie if it's a safe same-origin path.
  // decodeAppleOAuthState already filtered junk; re-check anyway as a
  // defence-in-depth — a future contributor adding fields shouldn't be
  // able to drop the validator without this layer screaming.
  const target =
    cookiePayload.from && isSafeReturnPath(cookiePayload.from)
      ? cookiePayload.from
      : "/";
  const res = NextResponse.redirect(new URL(target, publicOrigin(req)), {
    status: 303,
  });
  // Clear the one-shot state cookie.
  res.cookies.set({
    name: APPLE_OAUTH_STATE_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: 0,
  });
  // Mint the session cookie. SameSite=Lax is the right default — Lax allows
  // top-level GET cross-site (e.g. clicking a link in an email back to /),
  // which is what we want for a session cookie. Apple's callback POST is
  // already complete by the time this Set-Cookie lands; the redirect target
  // is same-site.
  res.cookies.set({
    name: COACH_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: COACH_SESSION_MAX_AGE_SEC,
  });
  return res;
}
