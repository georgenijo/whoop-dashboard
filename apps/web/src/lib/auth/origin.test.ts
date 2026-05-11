// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { publicOrigin } from "./origin";

function fakeReq(opts: {
  origin?: string;
  headers?: Record<string, string>;
} = {}): NextRequest {
  return {
    headers: new Headers(opts.headers ?? {}),
    nextUrl: { origin: opts.origin ?? "https://localhost:8501" },
  } as unknown as NextRequest;
}

describe("publicOrigin — precedence", () => {
  const originalEnv = process.env.PUBLIC_ORIGIN;

  beforeEach(() => {
    delete process.env.PUBLIC_ORIGIN;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PUBLIC_ORIGIN;
    else process.env.PUBLIC_ORIGIN = originalEnv;
  });

  it("returns PUBLIC_ORIGIN when set, ignoring request origin", () => {
    process.env.PUBLIC_ORIGIN = "https://coach.georgenijo.com";
    const req = fakeReq({ origin: "https://localhost:8501" });
    expect(publicOrigin(req)).toBe("https://coach.georgenijo.com");
  });

  it("strips path/query from PUBLIC_ORIGIN, returning only origin", () => {
    process.env.PUBLIC_ORIGIN = "https://coach.georgenijo.com/foo?bar=1";
    const req = fakeReq({ origin: "https://localhost:8501" });
    expect(publicOrigin(req)).toBe("https://coach.georgenijo.com");
  });

  it("trims whitespace around PUBLIC_ORIGIN", () => {
    process.env.PUBLIC_ORIGIN = "  https://coach.georgenijo.com  ";
    const req = fakeReq({ origin: "https://localhost:8501" });
    expect(publicOrigin(req)).toBe("https://coach.georgenijo.com");
  });

  it("falls through to request origin when PUBLIC_ORIGIN is malformed", () => {
    process.env.PUBLIC_ORIGIN = "not-a-url";
    const req = fakeReq({ origin: "https://localhost:3000" });
    expect(publicOrigin(req)).toBe("https://localhost:3000");
  });

  it("falls through to request origin when PUBLIC_ORIGIN is empty/whitespace", () => {
    process.env.PUBLIC_ORIGIN = "   ";
    const req = fakeReq({ origin: "https://localhost:3000" });
    expect(publicOrigin(req)).toBe("https://localhost:3000");
  });

  it("uses req.nextUrl.origin when PUBLIC_ORIGIN is unset (dev)", () => {
    const req = fakeReq({ origin: "http://localhost:3000" });
    expect(publicOrigin(req)).toBe("http://localhost:3000");
  });

  it("does not honor X-Forwarded-* headers (avoids spoofing)", () => {
    const req = fakeReq({
      origin: "https://localhost:8501",
      headers: {
        "x-forwarded-host": "evil.example.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(publicOrigin(req)).toBe("https://localhost:8501");
  });
});
