import "server-only";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = new URL("https://appleid.apple.com/auth/keys");
const JWKS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class AppleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppleAuthError";
  }
}

type JWKS = ReturnType<typeof createRemoteJWKSet>;

let cachedJWKS: JWKS | null = null;
let cachedAt = 0;

function getJWKS(): JWKS {
  const now = Date.now();
  if (!cachedJWKS || now - cachedAt > JWKS_TTL_MS) {
    cachedJWKS = createRemoteJWKSet(APPLE_JWKS_URL, {
      // jose handles per-kid caching internally; we still rotate the whole
      // remote set every 24h to bound staleness.
      cooldownDuration: 30_000,
    });
    cachedAt = now;
  }
  return cachedJWKS;
}

/** Test/dev hook — clears the in-memory JWKS cache. Not used in production. */
export function _resetAppleJWKSCacheForTests(): void {
  cachedJWKS = null;
  cachedAt = 0;
}

function bundleId(): string {
  const v = process.env.APPLE_BUNDLE_ID;
  if (!v) {
    throw new AppleAuthError("APPLE_BUNDLE_ID not configured");
  }
  return v;
}

export type AppleIdentity = {
  sub: string;
  email?: string;
};

/**
 * Verify a Sign in with Apple identity token.
 *
 * Validates signature against Apple's published JWKS, audience equals the
 * configured iOS bundle ID, issuer equals https://appleid.apple.com, and
 * expiry has not passed. Throws `AppleAuthError` on any failure.
 */
export async function verifyAppleIdentityToken(
  token: string
): Promise<AppleIdentity> {
  if (!token || typeof token !== "string") {
    throw new AppleAuthError("Missing identity token");
  }

  const aud = bundleId();
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, getJWKS(), {
      issuer: APPLE_ISSUER,
      audience: aud,
      algorithms: ["RS256"],
    });
    payload = result.payload;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "verification failed";
    throw new AppleAuthError(`Apple token verification failed: ${reason}`);
  }

  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new AppleAuthError("Apple token missing sub claim");
  }

  const email =
    typeof payload.email === "string" && payload.email.length > 0
      ? payload.email
      : undefined;

  return { sub: payload.sub, email };
}
