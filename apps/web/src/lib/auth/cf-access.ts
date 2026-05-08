import "server-only";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * Cloudflare Access JWT verifier.
 *
 * CF Access sits in front of `coach.georgenijo.com` and signs a per-request
 * assertion in the `Cf-Access-Jwt-Assertion` header. Validating it lets us
 * resolve the request to a real user (by verified email) without running our
 * own login flow on the web.
 *
 * Docs: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */

const CF_ACCESS_TEAM_DOMAIN =
  process.env.CF_ACCESS_TEAM_DOMAIN ?? "https://georgnijo.cloudflareaccess.com";
const CF_ACCESS_AUD =
  process.env.CF_ACCESS_AUD ?? "839d958e-7cec-4062-9ae3-b9f4451b86f9";
const CF_ACCESS_JWKS_URL = new URL(`${CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

export const CF_ACCESS_HEADER = "cf-access-jwt-assertion";

export class CFAccessAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CFAccessAuthError";
  }
}

type JWKS = ReturnType<typeof createRemoteJWKSet>;

let cachedJWKS: JWKS | null = null;
let cachedAt = 0;

function getJWKS(): JWKS {
  const now = Date.now();
  if (!cachedJWKS || now - cachedAt > JWKS_TTL_MS) {
    cachedJWKS = createRemoteJWKSet(CF_ACCESS_JWKS_URL, {
      // jose handles per-`kid` caching internally; we still rotate the whole
      // remote set every hour so a key rotation can't keep us pinned to a
      // stale set indefinitely.
      cooldownDuration: 30_000,
    });
    cachedAt = now;
  }
  return cachedJWKS;
}

/** Test/dev hook — clears the in-memory JWKS cache. */
export function _resetCFAccessJWKSCacheForTests(): void {
  cachedJWKS = null;
  cachedAt = 0;
}

export type CFAccessIdentity = {
  email: string;
  sub: string;
};

/**
 * Verify a Cloudflare Access JWT assertion.
 *
 * Validates signature against the team's published JWKS, audience equals the
 * configured Access app id, issuer equals the team domain, and expiry has
 * not passed. Throws `CFAccessAuthError` on any failure.
 */
export async function verifyCFAccessJWT(
  token: string
): Promise<CFAccessIdentity> {
  if (!token || typeof token !== "string") {
    throw new CFAccessAuthError("Missing CF Access assertion");
  }

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, getJWKS(), {
      issuer: CF_ACCESS_TEAM_DOMAIN,
      audience: CF_ACCESS_AUD,
      algorithms: ["RS256"],
    });
    payload = result.payload;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "verification failed";
    throw new CFAccessAuthError(`CF Access verification failed: ${reason}`);
  }

  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new CFAccessAuthError("CF Access token missing sub claim");
  }

  // CF Access puts the verified IdP email at `email` (occasionally `identity`).
  // Reject the token if neither is present rather than guessing.
  const email =
    typeof payload.email === "string" && payload.email.length > 0
      ? payload.email
      : null;

  if (!email) {
    throw new CFAccessAuthError("CF Access token missing email claim");
  }

  return { email: email.toLowerCase(), sub: payload.sub };
}
