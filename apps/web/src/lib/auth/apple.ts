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

export type VerifyAppleOpts = {
  /**
   * Audience claim(s) to accept. Defaults to `[APPLE_BUNDLE_ID]` (iOS native
   * flow). Web flow passes the Services ID instead. jose's `audience` option
   * matches a string or any element of an array, so a single verifier path
   * serves both surfaces without a fork.
   */
  audience?: string | string[];
};

/**
 * Verify a Sign in with Apple identity token.
 *
 * Validates signature against Apple's published JWKS, audience matches the
 * supplied value(s) (default: iOS bundle ID), issuer equals
 * https://appleid.apple.com, and expiry has not passed. Throws
 * `AppleAuthError` on any failure.
 *
 * The web Sign in with Apple flow MUST pass `audience: APPLE_SERVICES_ID`,
 * since Apple sets `aud` to the Services ID (not the iOS bundle ID) for
 * tokens minted from a web OAuth round-trip.
 */
export async function verifyAppleIdentityToken(
  token: string,
  opts: VerifyAppleOpts = {}
): Promise<AppleIdentity> {
  if (!token || typeof token !== "string") {
    throw new AppleAuthError("Missing identity token");
  }

  const aud = opts.audience ?? bundleId();
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
