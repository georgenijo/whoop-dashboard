import "server-only";
import crypto from "node:crypto";
import { whoopStateSecret } from "@/lib/auth";

/**
 * Signed `state` nonce for the Whoop OAuth round-trip.
 *
 * Carries the signed-in `user_id` from the start route through Whoop's
 * redirect back into our callback. Without this, the callback can't tell
 * which logged-in user is connecting — tokens would land on whichever user
 * the legacy `DEFAULT_USER_ID = 1` constant pointed at.
 *
 * Wire format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256 over payload)>`
 *
 *   payload = { u: <user_id>, n: <16-byte hex nonce>, e: <expires_at_ms> }
 *   key     = WHOOP_STATE_SECRET (env, base64-encoded, fail-closed loader)
 *   ttl     = 5 minutes (validated at decode time against current clock)
 *
 * Anything in this module is also enforced by the callback's cookie
 * byte-equality check — the cookie carries the same signed value, so a
 * forged URL state without a matching cookie is rejected before HMAC
 * verification runs.
 */

const TTL_MS = 5 * 60 * 1000;
const NONCE_BYTES = 16;

export type WhoopOAuthStatePayload = {
  user_id: number;
  /** Expiry in epoch milliseconds. Generated server-side; callers don't pass this. */
  exp?: number;
};

type EncodedPayload = {
  u: number;
  n: string;
  e: number;
};

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromBase64Url(s: string): Buffer | null {
  try {
    return Buffer.from(s, "base64url");
  } catch {
    return null;
  }
}

/**
 * Sign the payload. `exp` is computed if the caller doesn't supply one
 * (production callers don't — tests can override for expiry coverage).
 */
export function encodeWhoopOAuthState(payload: WhoopOAuthStatePayload): string {
  const exp = payload.exp ?? Date.now() + TTL_MS;
  // Object literal key order (u, n, e) is the canonical signing order.
  // V8 preserves insertion order on string keys, so this round-trips
  // deterministically. Do not refactor into a spread or a Map without
  // re-checking that JSON.stringify produces the same byte sequence —
  // a different order makes every existing signed state un-verifiable.
  const body: EncodedPayload = {
    u: payload.user_id,
    n: crypto.randomBytes(NONCE_BYTES).toString("hex"),
    e: exp,
  };
  const payloadBuf = Buffer.from(JSON.stringify(body), "utf8");
  const payloadB64 = toBase64Url(payloadBuf);
  const mac = crypto
    .createHmac("sha256", whoopStateSecret())
    .update(payloadBuf)
    .digest();
  return `${payloadB64}.${toBase64Url(mac)}`;
}

/**
 * Verify + decode. Returns `null` on any failure (malformed, tampered,
 * expired, missing fields). Never throws on bad input — only on a hard
 * config error (`WHOOP_STATE_SECRET` unset) so callers can surface a 503.
 *
 * Caller is responsible for byte-equality against the cookie BEFORE invoking
 * this — that's a cheap CSRF gate; HMAC is the integrity check on top.
 */
export function decodeWhoopOAuthState(
  raw: string | null | undefined
): { user_id: number; exp: number } | null {
  if (!raw || typeof raw !== "string") return null;
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return null;

  const payloadB64 = raw.slice(0, dot);
  const macB64 = raw.slice(dot + 1);

  const payloadBuf = fromBase64Url(payloadB64);
  const macBuf = fromBase64Url(macB64);
  if (!payloadBuf || !macBuf) return null;

  const expected = crypto
    .createHmac("sha256", whoopStateSecret())
    .update(payloadBuf)
    .digest();

  // `crypto.timingSafeEqual` throws on unequal lengths — guard first.
  if (expected.length !== macBuf.length) return null;
  if (!crypto.timingSafeEqual(expected, macBuf)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadBuf.toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (
    typeof o.u !== "number" ||
    !Number.isInteger(o.u) ||
    o.u <= 0 ||
    typeof o.n !== "string" ||
    !o.n ||
    typeof o.e !== "number" ||
    !Number.isFinite(o.e)
  ) {
    return null;
  }

  if (Date.now() > o.e) return null;

  return { user_id: o.u, exp: o.e };
}
