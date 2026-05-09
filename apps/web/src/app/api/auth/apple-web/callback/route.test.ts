import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));

// The route under test stitches three things together:
//   1. exchangeAppleAuthCode -> Apple's /auth/token (mocked)
//   2. verifyAppleIdentityToken -> JWKS verify (mocked)
//   3. upsertUserByAppleSub + signSessionToken (real, against tmp DB)
// We mock (1) at the module level and (2) at the @/lib/auth/apple level.

vi.mock("@/lib/auth/apple-web", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth/apple-web")>(
      "@/lib/auth/apple-web"
    );
  return {
    ...actual,
    loadAppleWebConfig: vi.fn(() => ({
      teamId: "TEAM",
      servicesId: "com.test.services",
      keyId: "KID",
      privateKeyPem: "stub",
    })),
    exchangeAppleAuthCode: vi.fn(async () => ({
      access_token: "apple-access",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "apple-refresh",
      id_token: "fake.id.token",
    })),
  };
});

vi.mock("@/lib/auth/apple", () => ({
  AppleAuthError: class AppleAuthError extends Error {},
  verifyAppleIdentityToken: vi.fn(async () => ({
    sub: "apple-sub-cb",
    email: "callback@example.com",
  })),
}));

vi.mock("@/lib/auth/jwt", () => ({
  signSessionToken: vi.fn(async () => ({
    token: "stub-session-jwt",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  })),
}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "apple-web-cb-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;
new Database(dbFile).close();

type RouteModule = typeof import("./route");
type ConnectionModule = typeof import("@/lib/db/connection");
let route: RouteModule;
let connection: ConnectionModule;

function readUserBySub(sub: string): { id: number } | null {
  const db = new Database(dbFile);
  try {
    return (
      (db
        .prepare("SELECT id FROM users WHERE apple_sub = ? LIMIT 1")
        .get(sub) as { id: number } | undefined) ?? null
    );
  } finally {
    db.close();
  }
}

function resetUsers(): void {
  const db = new Database(dbFile);
  try {
    db.prepare("DELETE FROM users WHERE id <> 1").run();
    db.prepare(
      "UPDATE users SET timezone = NULL, apple_sub = NULL, email = NULL WHERE id = 1"
    ).run();
  } finally {
    db.close();
  }
}

function makeRequest(
  body: Record<string, string>,
  cookies: Record<string, string> = {}
): Request {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) form.set(k, v);
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  // NextRequest is constructed by the runtime in production; in the test we
  // build a plain Request and let route.POST construct a NextRequest from it.
  // Actually the route signature takes NextRequest. The harness in Next test
  // utilities accepts either — we mimic by adding the cookie header.
  return new Request("http://localhost/api/auth/apple-web/callback", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    body: form.toString(),
  });
}

beforeAll(async () => {
  process.env.APPLE_SERVICES_ID = "com.test.services";
  process.env.APPLE_TEAM_ID = "TEAM";
  process.env.APPLE_KEY_ID = "KID";
  process.env.APPLE_PRIVATE_KEY = "stub";
  connection = await import("@/lib/db/connection");
  connection.openWrite()?.close();
  route = await import("./route");
});

beforeEach(() => {
  resetUsers();
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("POST /api/auth/apple-web/callback — happy path", () => {
  it("verifies state, exchanges code, persists user, and sets session cookie", async () => {
    // NextRequest cookies parsing reads from the `cookie` header — passing
    // it through the standard Request gives us the right shape via the
    // NextRequest wrapper inside the route.
    const req = makeRequest(
      { code: "auth-code-xyz", state: "state-abc" },
      { apple_oauth_state: "state-abc" }
    );
    // route.POST takes NextRequest; the actual runtime upgrades a Request.
    // We can rely on Next.js's exposed adapter:
    const { NextRequest } = await import("next/server");
    const nextReq = new NextRequest(req);
    const res = await route.POST(nextReq);

    // Apple's POST -> 303 redirect home (per spec). 303 is what See Other
    // gives us a clean GET-after-POST.
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/");

    const setCookies = res.headers
      .getSetCookie()
      .filter((c) => c.startsWith("__Host-coach_session="));
    expect(setCookies.length).toBe(1);
    expect(setCookies[0]).toContain("HttpOnly");
    expect(setCookies[0]).toContain("Secure");
    expect(setCookies[0]).toContain("Path=/");

    // Apple sub bound to user_id=1 (bootstrap binding branch).
    const row = readUserBySub("apple-sub-cb");
    expect(row?.id).toBe(1);
  });

  it("rejects when state cookie is missing", async () => {
    const req = makeRequest({ code: "x", state: "state-abc" }, {});
    const { NextRequest } = await import("next/server");
    const res = await route.POST(new NextRequest(req));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/signin");
    expect(res.headers.get("location")).toContain("error=state_cookie_missing");
  });

  it("rejects when state values do not match", async () => {
    const req = makeRequest(
      { code: "x", state: "wrong" },
      { apple_oauth_state: "right" }
    );
    const { NextRequest } = await import("next/server");
    const res = await route.POST(new NextRequest(req));
    expect(res.headers.get("location")).toContain("error=state_mismatch");
  });

  it("rejects when code is missing", async () => {
    const req = makeRequest(
      { state: "state-abc" },
      { apple_oauth_state: "state-abc" }
    );
    const { NextRequest } = await import("next/server");
    const res = await route.POST(new NextRequest(req));
    expect(res.headers.get("location")).toContain("error=missing_code");
  });

  it("propagates Apple's user-cancelled error code into the redirect", async () => {
    const req = makeRequest(
      { error: "user_cancelled_authorize", state: "state-abc" },
      { apple_oauth_state: "state-abc" }
    );
    const { NextRequest } = await import("next/server");
    const res = await route.POST(new NextRequest(req));
    expect(res.headers.get("location")).toContain("error=apple_user_cancelled_authorize");
  });

  it("rejects on equal-length state mismatch (constant-time path)", async () => {
    // Both values are exactly the same length (10 hex chars) so the early
    // length-check branch in safeStringEqual is bypassed and we exercise
    // crypto.timingSafeEqual itself. This is the regression that motivated
    // the fix — `!==` is variable-time and would have leaked timing.
    const req = makeRequest(
      { code: "auth-code", state: "1234567890" },
      { apple_oauth_state: "0987654321" }
    );
    const { NextRequest } = await import("next/server");
    const res = await route.POST(new NextRequest(req));
    expect(res.headers.get("location")).toContain("error=state_mismatch");
  });

  it("redirects to the `from` path captured at start when it is a safe path", async () => {
    // Cookie now uses the JSON envelope from apple-state.ts. The decoder
    // tolerates the legacy plain-string format, but the real start route
    // writes JSON — we cover that wire shape here.
    const cookieValue = JSON.stringify({ s: "state-from", f: "/sleep?range=7d" });
    const req = makeRequest(
      { code: "auth-code", state: "state-from" },
      { apple_oauth_state: cookieValue }
    );
    const { NextRequest } = await import("next/server");
    const res = await route.POST(new NextRequest(req));
    expect(res.status).toBe(303);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/sleep?range=7d");
    expect(loc).not.toMatch(/^https?:\/\/[^/]+\/(?:$|\?)/);
  });

  it("falls back to / when the captured `from` is unsafe", async () => {
    // Defence-in-depth: if anything bypasses the start-route validator and
    // writes a non-path `from` into the cookie, the callback's allowlist
    // re-check should silently downgrade to `/`. Note isSafeReturnPath is
    // also applied at decode time, so this test exercises the layered guard.
    const cookieValue = JSON.stringify({ s: "state-evil", f: "https://evil.com" });
    const req = makeRequest(
      { code: "auth-code", state: "state-evil" },
      { apple_oauth_state: cookieValue }
    );
    const { NextRequest } = await import("next/server");
    const res = await route.POST(new NextRequest(req));
    expect(res.status).toBe(303);
    const loc = res.headers.get("location") ?? "";
    expect(loc).not.toContain("evil.com");
    expect(loc).toMatch(/\/$/);
  });
});
