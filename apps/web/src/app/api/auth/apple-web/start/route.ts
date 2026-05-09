import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { APPLE_AUTHORIZE_URL } from "@/lib/auth/apple-web";

export const dynamic = "force-dynamic";

export const APPLE_OAUTH_STATE_COOKIE = "apple_oauth_state";
const STATE_COOKIE_TTL_SEC = 5 * 60;

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
    value: state,
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: STATE_COOKIE_TTL_SEC,
  });
  return res;
}
