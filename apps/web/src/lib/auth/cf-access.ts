import "server-only";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

// Docs: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

const CF_ACCESS_TEAM_DOMAIN_ENV = process.env.CF_ACCESS_TEAM_DOMAIN;
const CF_ACCESS_AUD_ENV = process.env.CF_ACCESS_AUD;
const CF_ACCESS_TEAM_DOMAIN =
  CF_ACCESS_TEAM_DOMAIN_ENV ?? "https://georgnijo.cloudflareaccess.com";
// Application Audience (AUD) Tag — the hex hash CF puts in JWT `aud`.
// NOT the Access App UUID (that's a different field; JWT verification fails if you use it).
const CF_ACCESS_AUD =
  CF_ACCESS_AUD_ENV ?? "de902ab4cf7ccc627fdf7efb620bdd7c21065c7028fdb05ae35e5ed01b7573e1";
const CF_ACCESS_JWKS_URL = new URL(`${CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);

if (process.env.NODE_ENV === "production") {
  if (!CF_ACCESS_TEAM_DOMAIN_ENV) {
    console.warn(
      `[cf-access] CF_ACCESS_TEAM_DOMAIN unset; defaulting to ${CF_ACCESS_TEAM_DOMAIN}`
    );
  }
  if (!CF_ACCESS_AUD_ENV) {
    console.warn(
      `[cf-access] CF_ACCESS_AUD unset; defaulting to ${CF_ACCESS_AUD}`
    );
  }
}

export const CF_ACCESS_HEADER = "cf-access-jwt-assertion";

export class CFAccessAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CFAccessAuthError";
  }
}

// jose's createRemoteJWKSet handles its own per-`kid` cache and refresh on
// kid-miss; cooldownDuration throttles refetches. No outer TTL needed.
const JWKS = createRemoteJWKSet(CF_ACCESS_JWKS_URL, {
  cooldownDuration: 30_000,
});

export type CFAccessIdentity = {
  email: string;
  sub: string;
};

export async function verifyCFAccessJWT(
  token: string
): Promise<CFAccessIdentity> {
  if (!token || typeof token !== "string") {
    throw new CFAccessAuthError("Missing CF Access assertion");
  }

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, JWKS, {
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

  const email =
    typeof payload.email === "string" && payload.email.length > 0
      ? payload.email
      : null;

  if (!email) {
    throw new CFAccessAuthError("CF Access token missing email claim");
  }

  return { email: email.toLowerCase(), sub: payload.sub };
}
