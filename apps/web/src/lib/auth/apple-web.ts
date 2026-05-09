import "server-only";
import { SignJWT, importPKCS8, type CryptoKey } from "jose";

/**
 * Apple Sign in with Apple (web) — server-to-server bits.
 *
 * The web OAuth round-trip exchanges an authorization code at
 * `https://appleid.apple.com/auth/token` using a `client_secret` JWT that
 * proves possession of the .p8 private key registered against the Services
 * ID. Apple specifies ES256 / aud=appleid.apple.com / max 6-month expiry.
 *
 * Reference: https://developer.apple.com/documentation/sign_in_with_apple/generate_and_validate_tokens
 */

export const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
export const APPLE_AUTHORIZE_URL = "https://appleid.apple.com/auth/authorize";
export const APPLE_AUDIENCE = "https://appleid.apple.com";

const ALG = "ES256";

// Apple caps the JWT lifetime at 6 months. We mint slightly under (180 days)
// and treat anything < 1 day from expiry as cold so we always have a buffer.
const SECRET_TTL_SEC = 180 * 24 * 60 * 60;
const REFRESH_BEFORE_SEC = 24 * 60 * 60;

export class AppleWebConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppleWebConfigError";
  }
}

export type AppleWebConfig = {
  teamId: string;
  servicesId: string;
  keyId: string;
  privateKeyPem: string;
};

type CachedSecret = {
  jwt: string;
  expSec: number;
  cacheKey: string;
};

let cached: CachedSecret | null = null;

/** Test hook — drops the in-memory client_secret cache. */
export function _resetAppleWebCacheForTests(): void {
  cached = null;
}

function readEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new AppleWebConfigError(`${name} not configured`);
  }
  return v.trim();
}

function decodePrivateKey(): string {
  const raw = readEnv("APPLE_PRIVATE_KEY");
  // Accept either base64-encoded PEM contents (preferred — survives env
  // round-trips with newlines) or a raw PEM block as-is. We sniff by header.
  if (raw.includes("BEGIN PRIVATE KEY")) {
    return raw;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64").toString("utf8");
  } catch {
    throw new AppleWebConfigError(
      "APPLE_PRIVATE_KEY must be a PEM block or base64-encoded PEM"
    );
  }
  if (!decoded.includes("BEGIN PRIVATE KEY")) {
    throw new AppleWebConfigError(
      "APPLE_PRIVATE_KEY did not decode to a PKCS#8 PEM"
    );
  }
  return decoded;
}

export function loadAppleWebConfig(): AppleWebConfig {
  return {
    teamId: readEnv("APPLE_TEAM_ID"),
    servicesId: readEnv("APPLE_SERVICES_ID"),
    keyId: readEnv("APPLE_KEY_ID"),
    privateKeyPem: decodePrivateKey(),
  };
}

async function importKey(pem: string): Promise<CryptoKey> {
  return await importPKCS8(pem, ALG);
}

/**
 * Build (or reuse) the `client_secret` JWT for Apple's token endpoint.
 *
 * Returns a freshly-signed JWT or a cached one whose remaining lifetime
 * exceeds `REFRESH_BEFORE_SEC`. Cache key includes team+services+keyId so a
 * config change invalidates the cache automatically.
 */
export async function buildAppleClientSecret(
  cfg: AppleWebConfig = loadAppleWebConfig()
): Promise<string> {
  const cacheKey = `${cfg.teamId}|${cfg.servicesId}|${cfg.keyId}`;
  const nowSec = Math.floor(Date.now() / 1000);
  if (
    cached &&
    cached.cacheKey === cacheKey &&
    cached.expSec - nowSec > REFRESH_BEFORE_SEC
  ) {
    return cached.jwt;
  }
  const key = await importKey(cfg.privateKeyPem);
  const expSec = nowSec + SECRET_TTL_SEC;
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: ALG, kid: cfg.keyId })
    .setIssuer(cfg.teamId)
    .setSubject(cfg.servicesId)
    .setAudience(APPLE_AUDIENCE)
    .setIssuedAt(nowSec)
    .setExpirationTime(expSec)
    .sign(key);
  cached = { jwt, expSec, cacheKey };
  return jwt;
}

export type AppleTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token: string;
};

/**
 * Exchange an authorization `code` (from the `/auth/authorize` callback) for
 * an `id_token` against Apple's token endpoint.
 *
 * Throws AppleWebConfigError on env misconfiguration; throws Error with
 * Apple's body text on non-2xx responses.
 */
export async function exchangeAppleAuthCode(
  code: string,
  redirectUri: string,
  cfg: AppleWebConfig = loadAppleWebConfig()
): Promise<AppleTokenResponse> {
  const clientSecret = await buildAppleClientSecret(cfg);
  const body = new URLSearchParams({
    client_id: cfg.servicesId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const resp = await fetch(APPLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Apple token exchange failed (${resp.status}): ${text}`);
  }
  return (await resp.json()) as AppleTokenResponse;
}
