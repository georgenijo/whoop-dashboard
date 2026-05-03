import "server-only";
import crypto from "node:crypto";

const SKEW_MS = 5 * 60 * 1000;

export type SignatureVerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_headers" | "bad_timestamp" | "skew" | "bad_signature" };

export function verifyWhoopSignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  clientSecret: string,
  nowMs: number = Date.now(),
): SignatureVerifyResult {
  if (!signatureHeader || !timestampHeader) {
    return { ok: false, reason: "missing_headers" };
  }

  const ts = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "bad_timestamp" };
  }
  if (Math.abs(nowMs - ts) > SKEW_MS) {
    return { ok: false, reason: "skew" };
  }

  // base64( HMAC-SHA256( timestamp_header + raw_http_request_body, client_secret ) )
  const expected = crypto
    .createHmac("sha256", clientSecret)
    .update(timestampHeader + rawBody, "utf8")
    .digest();

  let received: Buffer;
  try {
    received = Buffer.from(signatureHeader, "base64");
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (received.length !== expected.length) {
    return { ok: false, reason: "bad_signature" };
  }
  if (!crypto.timingSafeEqual(received, expected)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}
