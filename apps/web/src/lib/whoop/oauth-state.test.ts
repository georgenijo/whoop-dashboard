// @vitest-environment node
import nodeCrypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decodeWhoopOAuthState, encodeWhoopOAuthState } from "./oauth-state";

const ORIGINAL_SECRET = process.env.WHOOP_STATE_SECRET;

beforeEach(() => {
  // Stable test key so the value isn't tied to whatever an outer harness sets.
  process.env.WHOOP_STATE_SECRET = "test-secret-fixed-for-vitest";
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.WHOOP_STATE_SECRET;
  else process.env.WHOOP_STATE_SECRET = ORIGINAL_SECRET;
});

describe("encodeWhoopOAuthState / decodeWhoopOAuthState", () => {
  it("round-trips user_id through sign+verify", () => {
    const signed = encodeWhoopOAuthState({ user_id: 42 });
    const decoded = decodeWhoopOAuthState(signed);
    expect(decoded?.user_id).toBe(42);
    // exp is set on encode and surfaced on decode.
    expect(decoded?.exp).toBeGreaterThan(Date.now());
    // Default flow is "web" — absent on the wire, surfaced on decode.
    expect(decoded?.flow).toBe("web");
  });

  it("round-trips flow=ios through sign+verify", () => {
    const signed = encodeWhoopOAuthState({ user_id: 42, flow: "ios" });
    const decoded = decodeWhoopOAuthState(signed);
    expect(decoded?.user_id).toBe(42);
    expect(decoded?.flow).toBe("ios");
  });

  it("treats unknown flow values as web (no privilege escalation via attacker-chosen tag)", () => {
    // Hand-craft a signed payload with f="rogue" — decoder must coerce to "web".
    const malformed = (() => {
      const body = { u: 7, n: "abc", e: Date.now() + 60_000, f: "rogue" };
      const payloadBuf = Buffer.from(JSON.stringify(body), "utf8");
      const mac = nodeCrypto
        .createHmac("sha256", process.env.WHOOP_STATE_SECRET as string)
        .update(payloadBuf)
        .digest();
      return `${payloadBuf.toString("base64url")}.${mac.toString("base64url")}`;
    })();
    expect(decodeWhoopOAuthState(malformed)?.flow).toBe("web");
  });

  it("rejects a tampered payload (mac no longer matches)", () => {
    const signed = encodeWhoopOAuthState({ user_id: 7 });
    const dot = signed.indexOf(".");
    const payloadB64 = signed.slice(0, dot);
    const macB64 = signed.slice(dot + 1);
    // Flip one byte in the base64url payload. Pick a letter swap that stays
    // in the base64url alphabet so the buffer still decodes.
    const idx = Math.floor(payloadB64.length / 2);
    const ch = payloadB64[idx];
    const swapped = ch === "A" ? "B" : "A";
    const tamperedPayload = payloadB64.slice(0, idx) + swapped + payloadB64.slice(idx + 1);
    const tampered = `${tamperedPayload}.${macB64}`;
    expect(decodeWhoopOAuthState(tampered)).toBeNull();
  });

  it("rejects a truncated MAC (exercises the length guard before timingSafeEqual)", () => {
    const signed = encodeWhoopOAuthState({ user_id: 7 });
    const dot = signed.indexOf(".");
    const payloadB64 = signed.slice(0, dot);
    const macB64 = signed.slice(dot + 1);
    // Truncate the MAC by one base64url char — the decoded buffer will be
    // a different length, which would throw inside timingSafeEqual if we
    // forgot the explicit length guard.
    const tampered = `${payloadB64}.${macB64.slice(0, -2)}`;
    expect(decodeWhoopOAuthState(tampered)).toBeNull();
  });

  it("rejects a state signed with a different key", () => {
    const signed = encodeWhoopOAuthState({ user_id: 7 });
    process.env.WHOOP_STATE_SECRET = "a-different-key-entirely";
    expect(decodeWhoopOAuthState(signed)).toBeNull();
  });

  it("rejects an expired state", () => {
    const expired = encodeWhoopOAuthState({ user_id: 7, exp: Date.now() - 1 });
    expect(decodeWhoopOAuthState(expired)).toBeNull();
  });

  it("rejects malformed inputs", () => {
    expect(decodeWhoopOAuthState(null)).toBeNull();
    expect(decodeWhoopOAuthState("")).toBeNull();
    expect(decodeWhoopOAuthState("no-dot-separator")).toBeNull();
    expect(decodeWhoopOAuthState(".")).toBeNull();
    expect(decodeWhoopOAuthState("abc.")).toBeNull();
    expect(decodeWhoopOAuthState(".abc")).toBeNull();
  });

  it("rejects a state with non-integer user_id", () => {
    // Hand-craft a signed payload with u as a float — should be rejected.
    const malformed = (() => {
      const body = { u: 3.14, n: "abc", e: Date.now() + 60_000 };
      const payloadBuf = Buffer.from(JSON.stringify(body), "utf8");
      const mac = nodeCrypto
        .createHmac("sha256", process.env.WHOOP_STATE_SECRET as string)
        .update(payloadBuf)
        .digest();
      return `${payloadBuf.toString("base64url")}.${mac.toString("base64url")}`;
    })();
    expect(decodeWhoopOAuthState(malformed)).toBeNull();
  });
});
