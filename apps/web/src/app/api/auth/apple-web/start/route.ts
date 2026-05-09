import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { APPLE_AUTHORIZE_URL } from "@/lib/auth/apple-web";
import {
  APPLE_OAUTH_STATE_COOKIE,
  APPLE_OAUTH_STATE_MAX_AGE_SEC,
} from "@/lib/auth/cookies";
import { encodeAppleOAuthState, isSafeReturnPath } from "@/lib/auth/apple-state";

export const dynamic = "force-dynamic";

function callbackUrl(req: NextRequest): string {
  // Allow overriding via env so the same code path works behind a CDN /
  // tunnel where origin doesn't match the public URL Apple is calling back to.
  const override = process.env.APPLE_REDIRECT_URI;
  if (override && override.trim()) return override.trim();
  return new URL("/api/auth/apple-web/callback", req.nextUrl.origin).toString();
}

function servicesId(): string | null {
  const v = process.env.APPLE_SERVICES_ID;
  return v && v.trim() ? v.trim() : null;
}

export function GET(req: NextRequest) {
  const sid = servicesId();
  if (!sid) {
    return new NextResponse("APPLE_SERVICES_ID not configured", { status: 503 });
  }

  // `?from=/some/path` lets the proxy round-trip return-to. Validated
  // server-side; rejected if not a safe same-origin path so we can never
  // be coerced into an off-site redirect.
  const fromParam = req.nextUrl.searchParams.get("from");
  const from = isSafeReturnPath(fromParam) ? fromParam : undefined;

  const state = crypto.randomBytes(32).toString("hex");
  const params = new URLSearchParams({
    response_type: "code",
    response_mode: "form_post",
    scope: "name email",
    client_id: sid,
    redirect_uri: callbackUrl(req),
    state,
  });
  const authorizeUrl = `${APPLE_AUTHORIZE_URL}?${params.toString()}`;

  const res = NextResponse.redirect(authorizeUrl, { status: 302 });
  // SameSite=None because Apple POSTs the callback from a different origin
  // (cross-site). HttpOnly + Secure are mandatory companions. Path defaults
  // to / so the callback handler can read it back.
  res.cookies.set({
    name: APPLE_OAUTH_STATE_COOKIE,
    value: encodeAppleOAuthState({ state, from }),
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: APPLE_OAUTH_STATE_MAX_AGE_SEC,
  });
  return res;
}
