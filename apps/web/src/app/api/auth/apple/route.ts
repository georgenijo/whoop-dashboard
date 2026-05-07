import { NextResponse } from "next/server";
import { AppleAuthError, verifyAppleIdentityToken } from "@/lib/auth/apple";
import { signSessionToken } from "@/lib/auth/jwt";
import { upsertUserByAppleSub } from "@/lib/db";

export const dynamic = "force-dynamic";

type AppleAuthRequestBody = {
  identity_token?: unknown;
};

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

  let identity: { sub: string; email?: string };
  try {
    identity = await verifyAppleIdentityToken(identityToken);
  } catch (err) {
    if (err instanceof AppleAuthError) {
      return NextResponse.json({ error: "invalid_apple_token" }, { status: 401 });
    }
    throw err;
  }

  const user = upsertUserByAppleSub(identity.sub, identity.email);
  const { token, expiresAt } = await signSessionToken(user.id);

  return NextResponse.json({
    session_token: token,
    expires_at: expiresAt,
  });
}
