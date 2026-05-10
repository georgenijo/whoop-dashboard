import "server-only";
import http2 from "node:http2";
import { SignJWT, importPKCS8, type CryptoKey } from "jose";

/**
 * APNs (Apple Push Notification service) HTTP/2 sender, token-based auth.
 *
 * Reference:
 *   https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
 *
 * Apple's auth token is an ES256 JWT minted from the .p8 private key
 * registered in App Store Connect. Apple specifies:
 *   - JWT header: { alg: "ES256", kid: <Key ID>, typ: "JWT" }
 *   - JWT claims: { iss: <Team ID>, iat: <unix seconds> }   (no aud / exp)
 *   - Mint cadence: ≥ 20 minutes between mints (rate-limited window),
 *                   ≤ 60 minutes lifetime. We mint at 50 minutes to keep
 *                   one buffer minute on either side.
 *
 * The endpoint host is determined by APNS_ENVIRONMENT:
 *   - production  → api.push.apple.com
 *   - development → api.sandbox.push.apple.com
 *
 * TestFlight builds use the *production* APNs environment; the development
 * sandbox is only for Xcode-direct debug builds.
 */

const ALG = "ES256";
const PRODUCTION_HOST = "https://api.push.apple.com";
const SANDBOX_HOST = "https://api.sandbox.push.apple.com";

const TOKEN_TTL_SEC = 50 * 60;           // mint a fresh JWT every 50 minutes
const TOKEN_REFRESH_BEFORE_SEC = 60;     // refresh 1 min before nominal expiry

export class ApnsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApnsConfigError";
  }
}

export type ApnsEnvironment = "production" | "development";

export type ApnsConfig = {
  keyId: string;
  teamId: string;
  bundleId: string;
  privateKeyPem: string;
  environment: ApnsEnvironment;
};

export type ApnsAlertPayload = {
  /** APNs `aps.alert.title`. */
  title: string;
  /** APNs `aps.alert.body`. */
  body: string;
  /** Optional badge count. Omit to leave the badge unchanged. */
  badge?: number;
  /** Optional sound. Defaults to "default" so the device dings. */
  sound?: string;
  /**
   * Optional custom JSON merged into the top-level payload alongside `aps`.
   * Used by callers (#274b) to carry deep-link routing keys like
   * `route: "settings/connectors"` that the iOS tap handler reads.
   */
  custom?: Record<string, unknown>;
};

export type ApnsSendResult =
  | { ok: true; apnsId: string | null }
  | { ok: false; status: number; reason: string; apnsId: string | null };

/**
 * 410 Unregistered means the device token is permanently dead — caller
 * should delete the row. 400 BadDeviceToken means the token is malformed
 * or for the wrong environment; do NOT auto-delete (could be a config
 * mistake on our side).
 */
export function shouldRemoveTokenForReason(
  result: ApnsSendResult
): boolean {
  return !result.ok && result.status === 410 && result.reason === "Unregistered";
}

let cachedKey: { pem: string; key: CryptoKey } | null = null;
let cachedJwt: { jwt: string; expSec: number; cacheKey: string } | null = null;

/** Test hook — drops in-memory caches. */
export function _resetApnsCachesForTests(): void {
  cachedKey = null;
  cachedJwt = null;
}

function readEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new ApnsConfigError(`${name} not configured`);
  return v.trim();
}

/**
 * Mirror apple-web.ts:decodePrivateKey — accept either a raw PEM block or a
 * base64-encoded PEM. Same env footgun for both sets of Apple keys, so we
 * keep the decoder shape symmetric to avoid divergent failure modes.
 */
function decodePrivateKey(): string {
  const raw = readEnv("APNS_PRIVATE_KEY");
  if (raw.includes("BEGIN PRIVATE KEY")) return raw;
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64").toString("utf8");
  } catch {
    throw new ApnsConfigError(
      "APNS_PRIVATE_KEY must be a PEM block or base64-encoded PEM"
    );
  }
  if (!decoded.includes("BEGIN PRIVATE KEY")) {
    throw new ApnsConfigError(
      "APNS_PRIVATE_KEY did not decode to a PKCS#8 PEM"
    );
  }
  return decoded;
}

function readEnvironment(): ApnsEnvironment {
  const v = readEnv("APNS_ENVIRONMENT").toLowerCase();
  if (v !== "production" && v !== "development") {
    throw new ApnsConfigError(
      `APNS_ENVIRONMENT must be "production" or "development", got "${v}"`
    );
  }
  return v;
}

export function loadApnsConfig(): ApnsConfig {
  return {
    keyId: readEnv("APNS_KEY_ID"),
    teamId: readEnv("APNS_TEAM_ID"),
    bundleId: readEnv("APNS_BUNDLE_ID"),
    privateKeyPem: decodePrivateKey(),
    environment: readEnvironment(),
  };
}

async function importKey(pem: string): Promise<CryptoKey> {
  if (cachedKey && cachedKey.pem === pem) return cachedKey.key;
  const key = await importPKCS8(pem, ALG);
  cachedKey = { pem, key };
  return key;
}

async function buildAuthJwt(cfg: ApnsConfig): Promise<string> {
  const cacheKey = `${cfg.teamId}|${cfg.keyId}`;
  const nowSec = Math.floor(Date.now() / 1000);
  if (
    cachedJwt &&
    cachedJwt.cacheKey === cacheKey &&
    cachedJwt.expSec - nowSec > TOKEN_REFRESH_BEFORE_SEC
  ) {
    return cachedJwt.jwt;
  }
  const key = await importKey(cfg.privateKeyPem);
  const expSec = nowSec + TOKEN_TTL_SEC;
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: ALG, kid: cfg.keyId, typ: "JWT" })
    .setIssuer(cfg.teamId)
    .setIssuedAt(nowSec)
    .sign(key);
  cachedJwt = { jwt, expSec, cacheKey };
  return jwt;
}

export function apnsHostForEnvironment(env: ApnsEnvironment): string {
  return env === "production" ? PRODUCTION_HOST : SANDBOX_HOST;
}

function buildPayload(alert: ApnsAlertPayload): string {
  const aps: Record<string, unknown> = {
    alert: { title: alert.title, body: alert.body },
    sound: alert.sound ?? "default",
  };
  if (typeof alert.badge === "number") aps.badge = alert.badge;
  const root: Record<string, unknown> = { aps, ...(alert.custom ?? {}) };
  return JSON.stringify(root);
}

/**
 * Pluggable http2 entrypoint so tests can supply a stub session.
 */
type ConnectFn = typeof http2.connect;
let connectFnOverride: ConnectFn | null = null;

/** Test hook — replace `http2.connect` with a stub. */
export function _setHttp2ConnectForTests(fn: ConnectFn | null): void {
  connectFnOverride = fn;
}

function getConnectFn(): ConnectFn {
  return connectFnOverride ?? http2.connect;
}

type ApnsHttpResponse = {
  status: number;
  apnsId: string | null;
  body: string;
};

function performHttp2Request(
  cfg: ApnsConfig,
  jwt: string,
  token: string,
  payload: string
): Promise<ApnsHttpResponse> {
  return new Promise((resolve, reject) => {
    const host = apnsHostForEnvironment(cfg.environment);
    const session = getConnectFn()(host);
    let settled = false;
    const safeReject = (err: Error): void => {
      if (settled) return;
      settled = true;
      try {
        session.close();
      } catch {
        // ignore — best-effort
      }
      reject(err);
    };
    session.on("error", safeReject);
    const req = session.request({
      ":method": "POST",
      ":path": `/3/device/${token.toLowerCase()}`,
      "apns-topic": cfg.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      authorization: `bearer ${jwt}`,
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(payload)),
    });
    let status = 0;
    let apnsId: string | null = null;
    let body = "";
    req.on("response", (headers) => {
      const s = headers[":status"];
      status = typeof s === "number" ? s : Number(s ?? 0);
      const id = headers["apns-id"];
      apnsId = typeof id === "string" ? id : null;
    });
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        session.close();
      } catch {
        // ignore
      }
      resolve({ status, apnsId, body });
    });
    req.on("error", safeReject);
    req.write(payload);
    req.end();
  });
}

function parseReason(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body) as { reason?: unknown };
    return typeof parsed.reason === "string" ? parsed.reason : "";
  } catch {
    return "";
  }
}

/**
 * Send a single alert push to a single APNs device token.
 *
 * Returns a structured result rather than throwing on non-2xx so callers
 * can fan out to multiple tokens without one Unregistered killing the loop.
 * Throws ApnsConfigError on missing env or malformed key. Other unexpected
 * errors (network, malformed http2 frame) bubble up untyped.
 */
export async function sendAlertToToken(
  token: string,
  alert: ApnsAlertPayload,
  cfg: ApnsConfig = loadApnsConfig()
): Promise<ApnsSendResult> {
  const jwt = await buildAuthJwt(cfg);
  const payload = buildPayload(alert);
  const resp = await performHttp2Request(cfg, jwt, token, payload);
  if (resp.status === 200) {
    return { ok: true, apnsId: resp.apnsId };
  }
  const reason = parseReason(resp.body);
  return { ok: false, status: resp.status, reason, apnsId: resp.apnsId };
}
