// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  decodeAppleOAuthState,
  encodeAppleOAuthState,
  isSafeReturnPath,
} from "./apple-state";

describe("isSafeReturnPath — return-to allowlist", () => {
  it("accepts a normal same-origin path", () => {
    expect(isSafeReturnPath("/sleep")).toBe(true);
    expect(isSafeReturnPath("/recovery?range=30d")).toBe(true);
  });

  it("rejects protocol-relative URLs", () => {
    // `//evil.com/path` is parsed as a URL with host=evil.com by browsers.
    expect(isSafeReturnPath("//evil.com/path")).toBe(false);
  });

  it("rejects backslash-prefixed paths (Windows-style escape trick)", () => {
    expect(isSafeReturnPath("/\\evil.com")).toBe(false);
  });

  it("rejects absolute URLs", () => {
    expect(isSafeReturnPath("https://evil.com/path")).toBe(false);
    expect(isSafeReturnPath("http://example.test/path")).toBe(false);
  });

  it("rejects empty / non-string / overly long values", () => {
    expect(isSafeReturnPath("")).toBe(false);
    expect(isSafeReturnPath(undefined)).toBe(false);
    expect(isSafeReturnPath(null)).toBe(false);
    expect(isSafeReturnPath(123)).toBe(false);
    expect(isSafeReturnPath("/" + "a".repeat(2049))).toBe(false);
  });
});

describe("encodeAppleOAuthState / decodeAppleOAuthState", () => {
  it("round-trips state with no `from`", () => {
    const encoded = encodeAppleOAuthState({ state: "abc123" });
    const decoded = decodeAppleOAuthState(encoded);
    expect(decoded).toEqual({ state: "abc123" });
  });

  it("round-trips state with a safe `from` path", () => {
    const encoded = encodeAppleOAuthState({ state: "abc123", from: "/sleep?range=7d" });
    const decoded = decodeAppleOAuthState(encoded);
    expect(decoded).toEqual({ state: "abc123", from: "/sleep?range=7d" });
  });

  it("drops an unsafe `from` value at decode time even if it was encoded", () => {
    // Caller-side filtering should already reject these, but defence-in-depth
    // means decode also drops anything that fails the same allowlist.
    const encoded = JSON.stringify({ s: "abc", f: "https://evil.com" });
    const decoded = decodeAppleOAuthState(encoded);
    expect(decoded).toEqual({ state: "abc" });
  });

  it("drops `from` when it's a protocol-relative URL", () => {
    const encoded = JSON.stringify({ s: "abc", f: "//evil.com" });
    expect(decodeAppleOAuthState(encoded)).toEqual({ state: "abc" });
  });

  it("returns null for missing/empty input", () => {
    expect(decodeAppleOAuthState(null)).toBeNull();
    expect(decodeAppleOAuthState(undefined)).toBeNull();
    expect(decodeAppleOAuthState("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(decodeAppleOAuthState("{not json")).toBeNull();
  });

  it("returns null when the `s` claim is missing", () => {
    expect(decodeAppleOAuthState(JSON.stringify({ f: "/sleep" }))).toBeNull();
  });

  it("tolerates the legacy plain-string format (no JSON wrapper)", () => {
    // Forward-compat: a cookie set by a previous deploy that wrote raw hex
    // should still verify; we just lose the `from` round-trip until the
    // user signs in again from the new flow.
    expect(decodeAppleOAuthState("deadbeef0102030405")).toEqual({ state: "deadbeef0102030405" });
  });
});
