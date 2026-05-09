// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const ORIGINAL_SERVICES_ID = process.env.APPLE_SERVICES_ID;

beforeEach(() => {
  // Arm the auth gate. With APPLE_SERVICES_ID unset, every test below would
  // pass trivially because the gate is dormant — that's the production
  // safety, but for these tests we want to exercise the real branches.
  process.env.APPLE_SERVICES_ID = "com.test.services";
});

afterEach(() => {
  if (ORIGINAL_SERVICES_ID === undefined) delete process.env.APPLE_SERVICES_ID;
  else process.env.APPLE_SERVICES_ID = ORIGINAL_SERVICES_ID;
});

function makeRequest(
  pathname: string,
  opts: { cookie?: string; bearer?: string } = {}
): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  return new NextRequest(`https://example.test${pathname}`, { headers });
}

describe("proxy auth gate — exempt prefixes", () => {
  it("lets /api/whoop/webhook through (exact match, canonical form)", async () => {
    const { proxy } = await import("./proxy");
    const res = proxy(makeRequest("/api/whoop/webhook"));
    // NextResponse.next() returns a response with status 200 and no Location.
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets /api/whoop/webhook/ through (trailing-slash variant)", async () => {
    // Regression: the original exempt list was exact-match only, so a
    // request with a trailing slash would 307 to /signin and Whoop's
    // delivery would fail. Normalisation drops one trailing slash before
    // the exempt check.
    const { proxy } = await import("./proxy");
    const res = proxy(makeRequest("/api/whoop/webhook/"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets /api/auth/anything through (prefix match)", async () => {
    const { proxy } = await import("./proxy");
    const res = proxy(makeRequest("/api/auth/apple-web/start"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets /signin through (the destination of the redirect)", async () => {
    const { proxy } = await import("./proxy");
    const res = proxy(makeRequest("/signin"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets /api/admin/* through (admin uses its own bearer auth)", async () => {
    const { proxy } = await import("./proxy");
    const res = proxy(makeRequest("/api/admin/webhook/replay"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects an unauthenticated request for / to /signin (no `from` for root)", async () => {
    const { proxy } = await import("./proxy");
    const res = proxy(makeRequest("/"));
    expect(res.status).toBe(307);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/signin");
    expect(loc).not.toContain("from=");
  });

  it("redirects unauthenticated /sleep to /signin?from=/sleep", async () => {
    const { proxy } = await import("./proxy");
    const res = proxy(makeRequest("/sleep"));
    expect(res.status).toBe(307);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/signin");
    expect(loc).toContain("from=%2Fsleep");
  });

  it("lets a request with a session cookie through to a protected page", async () => {
    const { proxy } = await import("./proxy");
    const res = proxy(makeRequest("/sleep", { cookie: "__Host-coach_session=anything-truthy" }));
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets a request with Authorization: Bearer through (iOS path)", async () => {
    // Regression: the original gate only checked the cookie, so iOS API
    // calls (Bearer-authenticated, no cookie) got 307'd to /signin and the
    // app saw HTML. requireAuth re-verifies inside the route.
    const { proxy } = await import("./proxy");
    const res = proxy(makeRequest("/api/threads", { bearer: "fake.jwt.token" }));
    expect(res.headers.get("location")).toBeNull();
  });

  it("is dormant (no redirects) when APPLE_SERVICES_ID is unset", async () => {
    delete process.env.APPLE_SERVICES_ID;
    const { proxy } = await import("./proxy");
    const res = proxy(makeRequest("/sleep"));
    expect(res.headers.get("location")).toBeNull();
  });
});
