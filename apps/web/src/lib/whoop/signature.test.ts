import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { verifyWhoopSignature } from "./signature";

const SECRET = "test-secret";

function sign(ts: string, body: string, secret = SECRET): string {
  return crypto.createHmac("sha256", secret).update(ts + body).digest("base64");
}

describe("verifyWhoopSignature", () => {
  const now = 1_700_000_000_000;
  const ts = String(now);
  const body = '{"user_id":1,"id":"x","type":"sleep.updated","trace_id":"t"}';

  it("accepts a valid signature", () => {
    const sig = sign(ts, body);
    expect(verifyWhoopSignature(body, sig, ts, SECRET, now)).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    const sig = sign(ts, body);
    const result = verifyWhoopSignature(body + "X", sig, ts, SECRET, now);
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a wrong secret", () => {
    const sig = sign(ts, body, "other-secret");
    const result = verifyWhoopSignature(body, sig, ts, SECRET, now);
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects missing headers", () => {
    expect(verifyWhoopSignature(body, null, ts, SECRET, now)).toEqual({
      ok: false,
      reason: "missing_headers",
    });
    expect(verifyWhoopSignature(body, "x", null, SECRET, now)).toEqual({
      ok: false,
      reason: "missing_headers",
    });
  });

  it("rejects timestamp skew over 5 min", () => {
    const sig = sign(ts, body);
    const future = now + 6 * 60 * 1000;
    expect(verifyWhoopSignature(body, sig, ts, SECRET, future)).toEqual({
      ok: false,
      reason: "skew",
    });
  });

  it("accepts timestamp within 5 min skew", () => {
    const sig = sign(ts, body);
    const future = now + 4 * 60 * 1000;
    expect(verifyWhoopSignature(body, sig, ts, SECRET, future)).toEqual({ ok: true });
  });

  it("rejects bad timestamp format", () => {
    const sig = sign(ts, body);
    expect(verifyWhoopSignature(body, sig, "not-a-number", SECRET, now)).toEqual({
      ok: false,
      reason: "bad_timestamp",
    });
  });
});
