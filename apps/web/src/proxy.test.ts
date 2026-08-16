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

  it("returns 401 JSON for unauthenticated /api/* (no cookie, no Bearer)", async () => {
    // Regression: HTTP clients (iOS without Bearer, curl, fetch, future
    // webhooks) used to receive a 307 redirect to /signin and tried to
    // parse HTML. They should get a clean 401 JSON envelope instead.
    const { proxy } = await import("./proxy");
    const res = proxy(makeRequest("/api/dashboard/today"));
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
    const body = await res.json();
    expect(body).toEqual({ error: "unauthorized" });
  });

  it("still 307s unauthenticated page routes to /signin (browser flow preserved)", async () => {
    // Counter-regression: only /api/* should switch to JSON 401. Browser
    // page routes must keep the redirect so users land on the sign-in page.
    const { proxy } = await import("./proxy");
    const res = proxy(makeRequest("/coach"));
    expect(res.status).toBe(307);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/signin");
    expect(loc).toContain("from=%2Fcoach");
  });
});

describe("proxy auth gate — publicOrigin (issue #290)", () => {
  const ORIGINAL_PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN;

  afterEach(() => {
    if (ORIGINAL_PUBLIC_ORIGIN === undefined) delete process.env.PUBLIC_ORIGIN;
    else process.env.PUBLIC_ORIGIN = ORIGINAL_PUBLIC_ORIGIN;
  });

  it("uses PUBLIC_ORIGIN for the /signin redirect target", async () => {
    // Simulate the live bug: req comes in on the upstream listener but
    // PUBLIC_ORIGIN points to the public hostname.
    process.env.PUBLIC_ORIGIN = "https://coach.georgenijo.com";
    const { proxy } = await import("./proxy");
    const req = new NextRequest("https://localhost:8501/sleep");
    const res = proxy(req);
    expect(res.status).toBe(307);
    const loc = res.headers.get("location") ?? "";
    expect(loc.startsWith("https://coach.georgenijo.com/signin")).toBe(true);
  });

  it("falls back to request origin when PUBLIC_ORIGIN is unset (dev)", async () => {
    delete process.env.PUBLIC_ORIGIN;
    const { proxy } = await import("./proxy");
    const req = new NextRequest("http://localhost:3000/sleep");
    const res = proxy(req);
    expect(res.status).toBe(307);
    const loc = res.headers.get("location") ?? "";
    expect(loc.startsWith("http://localhost:3000/signin")).toBe(true);
  });
});

describe("proxy — Content-Security-Policy-Report-Only (issue #501)", () => {
  const HEADER = "content-security-policy-report-only";

  it("attaches a report-only policy to page responses", async () => {
    const { proxy } = await import("./proxy");
    const res = proxy(makeRequest("/sleep", { cookie: "__Host-coach_session=x" }));
    const csp = res.headers.get(HEADER);
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self' data: blob:");
  });

  it("attaches it to the /signin redirect too, not just 200s", async () => {
    // The auth gate returns early, before the rest of the proxy runs. An
    // earlier draft of this change let those responses out bare.
    const { proxy } = await import("./proxy");
    const res = proxy(makeRequest("/sleep"));
    expect(res.status).toBe(307);
    expect(res.headers.get(HEADER)).toContain("default-src 'self'");
  });

  it("mints a fresh nonce for every request", async () => {
    const { proxy } = await import("./proxy");
    const nonceOf = (path: string) =>
      proxy(makeRequest(path, { cookie: "__Host-coach_session=x" }))
        .headers.get(HEADER)
        ?.match(/'nonce-([^']+)'/)?.[1];
    const first = nonceOf("/sleep");
    const second = nonceOf("/sleep");
    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it("skips /api/* — JSON responses are not parsed as documents", async () => {
    const { proxy } = await import("./proxy");
    const res = proxy(
      makeRequest("/api/dashboard/today", { cookie: "__Host-coach_session=x" })
    );
    expect(res.headers.get(HEADER)).toBeNull();
  });

  it("ignores a client-supplied policy header on the request", async () => {
    // Next.js reads the nonce back out of the REQUEST header to stamp its
    // script tags. If a caller could set that header, they would choose the
    // nonce the page renders — which is the entire protection.
    const { proxy } = await import("./proxy");
    const req = new NextRequest("https://example.test/sleep", {
      headers: {
        cookie: "__Host-coach_session=x",
        "content-security-policy-report-only":
          "script-src 'nonce-attacker-chosen'",
      },
    });
    const res = proxy(req);
    expect(res.headers.get(HEADER)).not.toContain("attacker-chosen");
    // Next serialises the rewritten request headers into
    // `x-middleware-request-*` and rebuilds the request from them. That is
    // the value the renderer will read the nonce out of.
    const forwarded = res.headers.get(`x-middleware-request-${HEADER}`);
    expect(forwarded).toBeTruthy();
    expect(forwarded).not.toContain("attacker-chosen");
    expect(forwarded).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  });

  it("strips a client-supplied policy header on /api/* too", async () => {
    // The API branch mints no nonce, so it must DELETE rather than overwrite
    // — otherwise the spoofed header would be forwarded verbatim.
    const { proxy } = await import("./proxy");
    const req = new NextRequest("https://example.test/api/dashboard/today", {
      headers: {
        cookie: "__Host-coach_session=x",
        "content-security-policy-report-only":
          "script-src 'nonce-attacker-chosen'",
      },
    });
    const res = proxy(req);
    const overridden = res.headers.get("x-middleware-override-headers") ?? "";
    expect(overridden.split(",")).not.toContain(HEADER);
    expect(res.headers.get(`x-middleware-request-${HEADER}`)).toBeNull();
  });
});
