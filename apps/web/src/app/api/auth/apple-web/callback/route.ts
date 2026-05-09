import { NextResponse, type NextRequest } from "next/server";
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
  COACH_SESSION_COOKIE,
  COACH_SESSION_MAX_AGE_SEC,
} from "@/lib/auth/cookies";
import { APPLE_OAUTH_STATE_COOKIE } from "../start/route";

export const dynamic = "force-dynamic";

function callbackUrl(req: NextRequest): string {
  const override = process.env.APPLE_REDIRECT_URI;
  if (override && override.trim()) return override.trim();
  return new URL("/api/auth/apple-web/callback", req.nextUrl.origin).toString();
}

function bail(req: NextRequest, reason: string, status = 400): NextResponse {
  // Send the user back to /signin with an error code rather than a raw 4xx —
  // they should see the page, not a JSON corpse. status= is preserved on
  // direct API testing because we mirror it onto the redirect.
  const url = new URL("/signin", req.nextUrl.origin);
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

  const cookieState = req.cookies.get(APPLE_OAUTH_STATE_COOKIE)?.value;
  if (!cookieState) {
    return bail(req, "state_cookie_missing", 400);
  }
  if (cookieState !== state) {
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
    console.error(
      `[apple-web/callback] token exchange failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return bail(req, "token_exchange_failed", 502);
  }

  let identity;
  try {
    identity = await verifyAppleIdentityToken(tokenResp.id_token, {
      audience: cfg.servicesId,
    });
  } catch (err) {
    console.error(
      `[apple-web/callback] id_token verify failed: ${
        err instanceof Error ? err.message : String(err)
      }`
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

  const res = NextResponse.redirect(new URL("/", req.nextUrl.origin), {
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
