import "server-only";
import { SignJWT, jwtVerify } from "jose";

const ISSUER = "coach-api";
const ALG = "HS256";
const EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days

function signingKey(): Uint8Array {
  const raw = process.env.JWT_SIGNING_KEY;
  if (!raw) {
    throw new Error("JWT_SIGNING_KEY not configured");
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(raw, "base64");
  } catch {
    throw new Error("JWT_SIGNING_KEY must be base64-encoded");
  }
  if (bytes.length < 32) {
    throw new Error("JWT_SIGNING_KEY must decode to at least 32 bytes");
  }
  return new Uint8Array(bytes);
}

export type SignedSession = {
  token: string;
  /** ISO 8601 timestamp at which the token expires. */
  expiresAt: string;
};

export async function signSessionToken(userId: number): Promise<SignedSession> {
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + EXPIRY_SECONDS;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: ALG })
    .setSubject(String(userId))
    .setIssuer(ISSUER)
    .setIssuedAt(nowSec)
    .setExpirationTime(expSec)
    .sign(signingKey());
  return {
    token,
    expiresAt: new Date(expSec * 1000).toISOString(),
  };
}

export async function verifySessionToken(
  token: string
): Promise<{ userId: number } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      issuer: ISSUER,
      algorithms: [ALG],
    });
    if (typeof payload.sub !== "string") return null;
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) return null;
    return { userId };
  } catch {
    return null;
  }
}
