// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { publicOrigin } from "./origin";

describe("publicOrigin — precedence", () => {
  const originalEnv = process.env.PUBLIC_ORIGIN;

  beforeEach(() => {
    delete process.env.PUBLIC_ORIGIN;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PUBLIC_ORIGIN;
    else process.env.PUBLIC_ORIGIN = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns PUBLIC_ORIGIN when set, ignoring request origin", () => {
    process.env.PUBLIC_ORIGIN = "https://coach.georgenijo.com";
    const req = new NextRequest("https://localhost:8501/sleep");
    expect(publicOrigin(req)).toBe("https://coach.georgenijo.com");
  });

  it("strips path/query from PUBLIC_ORIGIN, returning only origin", () => {
    process.env.PUBLIC_ORIGIN = "https://coach.georgenijo.com/foo?bar=1";
    const req = new NextRequest("https://localhost:8501/sleep");
    expect(publicOrigin(req)).toBe("https://coach.georgenijo.com");
  });

  it("trims whitespace around PUBLIC_ORIGIN", () => {
    process.env.PUBLIC_ORIGIN = "  https://coach.georgenijo.com  ";
    const req = new NextRequest("https://localhost:8501/sleep");
    expect(publicOrigin(req)).toBe("https://coach.georgenijo.com");
  });

  it("falls through to request origin when PUBLIC_ORIGIN is malformed + warns once", async () => {
    process.env.PUBLIC_ORIGIN = "not-a-url";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // Re-import to reset the module-scoped `warnedMalformed` flag so this
    // test is independent of any earlier test that may have tripped it.
    vi.resetModules();
    const { publicOrigin: fresh } = await import("./origin");
    const req = new NextRequest("https://localhost:3000/x");
    expect(fresh(req)).toBe("https://localhost:3000");
    // Second call same process — should NOT log again (one-shot warn).
    expect(fresh(req)).toBe("https://localhost:3000");
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0][0]).toContain("PUBLIC_ORIGIN is set but not a valid URL");
  });

  it("falls through to request origin when PUBLIC_ORIGIN is empty/whitespace", () => {
    process.env.PUBLIC_ORIGIN = "   ";
    const req = new NextRequest("https://localhost:3000/x");
    expect(publicOrigin(req)).toBe("https://localhost:3000");
  });

  it("uses req.nextUrl.origin when PUBLIC_ORIGIN is unset (dev)", () => {
    const req = new NextRequest("http://localhost:3000/x");
    expect(publicOrigin(req)).toBe("http://localhost:3000");
  });

  it("does not honor X-Forwarded-* headers (avoids spoofing)", () => {
    const req = new NextRequest("https://localhost:8501/x", {
      headers: {
        "x-forwarded-host": "evil.example.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(publicOrigin(req)).toBe("https://localhost:8501");
  });
});
