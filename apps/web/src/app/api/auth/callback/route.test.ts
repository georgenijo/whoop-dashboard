// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

// The callback's only domain side-effect is exchangeCode. Mock it so we can
// observe whether the route reached the exchange (and with what userId)
// without persisting to a real DB. Failure tests assert the mock was NEVER
// invoked — the integrity gate must fail BEFORE token exchange.
const exchangeCodeMock = vi.fn<(userId: number, code: string) => Promise<void>>(
  async () => undefined,
);

vi.mock("@/lib/auth", () => ({
  exchangeCode: (userId: number, code: string) => exchangeCodeMock(userId, code),
  // The state helper module reads WHOOP_STATE_SECRET from process.env directly,
  // and we set that in beforeEach below — but the helper also imports
  // whoopStateSecret() from @/lib/auth. So we must stub it here too.
  whoopStateSecret: () => process.env.WHOOP_STATE_SECRET ?? "",
}));

vi.mock("@/lib/auth/origin", () => ({
  publicOrigin: () => "http://localhost",
}));

// Phase E.1 — the callback now branches on user_settings.onboarded_at. Mock
// the DB lookup so each test controls the destination explicitly: returning
// null (un-onboarded) → /welcome?stage=sync; returning a populated row →
// "/" (the re-auth path).
const getUserSettingsMock =
  vi.fn<(userId: number) => { onboarded_at: string | null } | null>(() => null);
vi.mock("@/lib/db", () => ({
  getUserSettings: (userId: number) => getUserSettingsMock(userId),
}));

// Phase D side-effect — the callback writes integrations.provider_user_id
// after exchangeCode. Stub it out so tests don't touch the real DB; existing
// asserts only care about the redirect + exchangeCode side-effect.
const setProviderUserIdMock = vi.fn<
  (userId: number, provider: string, providerUserId: string) => void
>(() => undefined);
vi.mock("@/lib/db/integrations", () => ({
  setProviderUserId: (
    userId: number,
    provider: string,
    providerUserId: string,
  ) => setProviderUserIdMock(userId, provider, providerUserId),
}));

// Profile fetch — stubbed so we don't hit the real Whoop API in tests. The
// route swallows failures from this call (provider_user_id is recoverable),
// so a fake profile is the simplest contract.
const getWhoopProfileMock = vi.fn<
  (opts: { userId: number }) => Promise<{
    user_id: number;
    email?: string;
    first_name?: string;
    last_name?: string;
  }>
>(async () => ({
  user_id: 123,
  email: "x@y.z",
  first_name: "X",
  last_name: "Y",
}));
vi.mock("@/lib/whoop/client", () => ({
  getWhoopProfile: (opts: { userId: number }) => getWhoopProfileMock(opts),
}));

const TEST_SECRET = "test-secret-for-callback-route";

beforeEach(() => {
  exchangeCodeMock.mockReset();
  exchangeCodeMock.mockImplementation(async () => undefined);
  getUserSettingsMock.mockReset();
  getUserSettingsMock.mockImplementation(() => null);
  setProviderUserIdMock.mockReset();
  setProviderUserIdMock.mockImplementation(() => undefined);
  getWhoopProfileMock.mockReset();
  getWhoopProfileMock.mockImplementation(async () => ({
    user_id: 123,
    email: "x@y.z",
    first_name: "X",
    last_name: "Y",
  }));
  process.env.WHOOP_STATE_SECRET = TEST_SECRET;
});

afterEach(() => {
  delete process.env.WHOOP_STATE_SECRET;
});

async function importRoute() {
  return await import("./route");
}

async function importState() {
  return await import("@/lib/whoop/oauth-state");
}

function buildRequest({
  state,
  cookieState,
  code = "valid-code",
}: {
  state?: string | null;
  cookieState?: string | null;
  code?: string | null;
}): NextRequest {
  const url = new URL("http://localhost/api/auth/callback");
  if (code != null) url.searchParams.set("code", code);
  if (state != null) url.searchParams.set("state", state);
  const headers = new Headers();
  if (cookieState != null) {
    headers.set("cookie", `whoop_oauth_state=${cookieState}`);
  }
  return new NextRequest(url.toString(), { method: "GET", headers });
}

describe("GET /api/auth/callback — Whoop OAuth state verification", () => {
  it("happy path (un-onboarded): matched state + valid HMAC → /welcome?stage=sync", async () => {
    const { encodeWhoopOAuthState } = await importState();
    const { GET } = await importRoute();
    const signed = encodeWhoopOAuthState({ user_id: 42 });

    // Default mock returns null = un-onboarded. Phase E.1 routes these users
    // into the wizard's sync stage so the first 7-day pull runs visibly.
    const res = await GET(
      buildRequest({ state: signed, cookieState: signed }),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost/welcome?stage=sync",
    );
    expect(exchangeCodeMock).toHaveBeenCalledTimes(1);
    expect(exchangeCodeMock.mock.calls[0][0]).toBe(42);
  });

  it("happy path (already onboarded): matched state + valid HMAC → /", async () => {
    const { encodeWhoopOAuthState } = await importState();
    const { GET } = await importRoute();
    const signed = encodeWhoopOAuthState({ user_id: 42 });
    getUserSettingsMock.mockImplementation(() => ({
      onboarded_at: "2026-01-01T00:00:00Z",
    }));

    const res = await GET(
      buildRequest({ state: signed, cookieState: signed }),
    );

    expect(res.status).toBe(307);
    // Re-auth flow lands back on the dashboard, not the wizard.
    expect(res.headers.get("location")).toBe("http://localhost/");
  });

  it("state_missing: no cookie → redirect to /settings?whoop_error=state_missing, no exchange", async () => {
    const { encodeWhoopOAuthState } = await importState();
    const { GET } = await importRoute();
    const signed = encodeWhoopOAuthState({ user_id: 42 });

    const res = await GET(
      buildRequest({ state: signed, cookieState: null }),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("whoop_error=state_missing");
    expect(exchangeCodeMock).not.toHaveBeenCalled();
  });

  it("state_mismatch: URL state ≠ cookie state → no exchange", async () => {
    const { encodeWhoopOAuthState } = await importState();
    const { GET } = await importRoute();
    // Two distinct signed states — both valid HMAC, but they don't match.
    const a = encodeWhoopOAuthState({ user_id: 42 });
    const b = encodeWhoopOAuthState({ user_id: 99 });

    const res = await GET(buildRequest({ state: a, cookieState: b }));

    expect(res.headers.get("location")).toContain("whoop_error=state_mismatch");
    expect(exchangeCodeMock).not.toHaveBeenCalled();
  });

  it("state_invalid: tampered payload (HMAC fails) → no exchange", async () => {
    const { encodeWhoopOAuthState } = await importState();
    const { GET } = await importRoute();
    const signed = encodeWhoopOAuthState({ user_id: 42 });
    // Flip one base64url char in the payload portion. The MAC won't match.
    const dot = signed.indexOf(".");
    const payloadB64 = signed.slice(0, dot);
    const macB64 = signed.slice(dot + 1);
    const idx = Math.floor(payloadB64.length / 2);
    const ch = payloadB64[idx];
    const swap = ch === "A" ? "B" : "A";
    const tampered = `${payloadB64.slice(0, idx)}${swap}${payloadB64.slice(idx + 1)}.${macB64}`;

    // Cookie matches URL byte-for-byte (so the cheap CSRF gate passes), but
    // HMAC verification still rejects the payload.
    const res = await GET(
      buildRequest({ state: tampered, cookieState: tampered }),
    );

    expect(res.headers.get("location")).toContain("whoop_error=state_invalid");
    expect(exchangeCodeMock).not.toHaveBeenCalled();
  });

  it("state_invalid: expired state → no exchange", async () => {
    const { encodeWhoopOAuthState } = await importState();
    const { GET } = await importRoute();
    // Encode an already-expired state. Cookie and URL still byte-match so
    // we land on the HMAC step, where the expiry check fires.
    const expired = encodeWhoopOAuthState({ user_id: 42, exp: Date.now() - 1 });

    const res = await GET(
      buildRequest({ state: expired, cookieState: expired }),
    );

    expect(res.headers.get("location")).toContain("whoop_error=state_invalid");
    expect(exchangeCodeMock).not.toHaveBeenCalled();
  });

  it("user_cancelled: Whoop ?error=access_denied → distinct UX code, no exchange", async () => {
    const { GET } = await importRoute();
    const url = new URL("http://localhost/api/auth/callback");
    url.searchParams.set("error", "access_denied");
    const req = new NextRequest(url.toString(), { method: "GET" });

    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("whoop_error=user_cancelled");
    expect(exchangeCodeMock).not.toHaveBeenCalled();
  });

  it("exchange_failed: Whoop ?error=<other> → generic exchange_failed code", async () => {
    const { GET } = await importRoute();
    const url = new URL("http://localhost/api/auth/callback");
    url.searchParams.set("error", "server_error");
    const req = new NextRequest(url.toString(), { method: "GET" });

    const res = await GET(req);

    expect(res.headers.get("location")).toContain("whoop_error=exchange_failed");
    expect(exchangeCodeMock).not.toHaveBeenCalled();
  });

  it("exchange_failed: state ok but exchangeCode throws → redirect with error code", async () => {
    const { encodeWhoopOAuthState } = await importState();
    const { GET } = await importRoute();
    exchangeCodeMock.mockImplementation(async () => {
      throw new Error("whoop 500: oops");
    });
    const signed = encodeWhoopOAuthState({ user_id: 42 });

    const res = await GET(
      buildRequest({ state: signed, cookieState: signed }),
    );

    expect(res.headers.get("location")).toContain("whoop_error=exchange_failed");
    // The error message must NOT leak into the URL — only the short code.
    expect(res.headers.get("location")).not.toMatch(/oops/);
  });

  it("iOS flow happy path: state with flow=ios, no cookie required → coach://oauth-complete?status=ok", async () => {
    const { encodeWhoopOAuthState } = await importState();
    const { GET } = await importRoute();
    const signed = encodeWhoopOAuthState({ user_id: 42, flow: "ios" });

    // No cookieState — iOS flow uses an ephemeral cookie jar inside
    // ASWebAuthenticationSession that has no path back to the web session.
    const res = await GET(buildRequest({ state: signed, cookieState: null }));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "coach://oauth-complete?status=ok",
    );
    expect(exchangeCodeMock).toHaveBeenCalledTimes(1);
    expect(exchangeCodeMock.mock.calls[0][0]).toBe(42);
  });

  it("iOS flow exchange failure: redirects to coach://oauth-complete?status=error&code=exchange_failed", async () => {
    const { encodeWhoopOAuthState } = await importState();
    const { GET } = await importRoute();
    exchangeCodeMock.mockImplementation(async () => {
      throw new Error("whoop 500: oops");
    });
    const signed = encodeWhoopOAuthState({ user_id: 42, flow: "ios" });

    const res = await GET(buildRequest({ state: signed, cookieState: null }));

    expect(res.headers.get("location")).toBe(
      "coach://oauth-complete?status=error&code=exchange_failed",
    );
  });

  it("iOS flow user cancel: ?error=access_denied with flow=ios → custom scheme, not /settings", async () => {
    const { encodeWhoopOAuthState } = await importState();
    const { GET } = await importRoute();
    const signed = encodeWhoopOAuthState({ user_id: 42, flow: "ios" });

    const url = new URL("http://localhost/api/auth/callback");
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("state", signed);
    const req = new NextRequest(url.toString(), { method: "GET" });

    const res = await GET(req);

    expect(res.headers.get("location")).toBe(
      "coach://oauth-complete?status=error&code=user_cancelled",
    );
    expect(exchangeCodeMock).not.toHaveBeenCalled();
  });
});
