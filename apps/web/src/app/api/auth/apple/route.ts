import { NextResponse } from "next/server";
import { AppleAuthError, verifyAppleIdentityToken } from "@/lib/auth/apple";
import { signSessionToken } from "@/lib/auth/jwt";
import { upsertUserByAppleSub } from "@/lib/db";

export const dynamic = "force-dynamic";

type AppleAuthRequestBody = {
  identity_token?: unknown;
  tz?: unknown;
};

const TZ_MAX_LENGTH = 100;

// TZ is opt-in; invalid input never rejects auth.
function sanitizeTimezone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > TZ_MAX_LENGTH) return null;
  try {
    // resolvedOptions().timeZone normalizes case and offset aliases (e.g.
    // "america/new_york" → "America/New_York", "+00:00" → "UTC") so Phase 3
    // jobs reading users.timezone get a single canonical IANA name.
    return new Intl.DateTimeFormat("en-US", { timeZone: trimmed })
      .resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: AppleAuthRequestBody;
  try {
    body = (await req.json()) as AppleAuthRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const identityToken = body?.identity_token;
  if (typeof identityToken !== "string" || !identityToken.trim()) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const tz = sanitizeTimezone(body?.tz);

  let identity: { sub: string; email?: string };
  try {
    identity = await verifyAppleIdentityToken(identityToken);
  } catch (err) {
    if (err instanceof AppleAuthError) {
      return NextResponse.json({ error: "invalid_apple_token" }, { status: 401 });
    }
    throw err;
  }

  const user = upsertUserByAppleSub(identity.sub, identity.email, tz);
  const { token, expiresAt } = await signSessionToken(user.id);

  return NextResponse.json({
    session_token: token,
    expires_at: expiresAt,
  });
}
