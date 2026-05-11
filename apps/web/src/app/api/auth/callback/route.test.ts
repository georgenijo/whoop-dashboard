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

const TEST_SECRET = "test-secret-for-callback-route";

beforeEach(() => {
  exchangeCodeMock.mockReset();
  exchangeCodeMock.mockImplementation(async () => undefined);
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
  it("happy path: matched state + valid HMAC → calls exchangeCode(user_id)", async () => {
    const { encodeWhoopOAuthState } = await importState();
    const { GET } = await importRoute();
    const signed = encodeWhoopOAuthState({ user_id: 42 });

    const res = await GET(
      buildRequest({ state: signed, cookieState: signed }),
    );

    expect(res.status).toBe(307);
    // Redirects home after a successful exchange.
    expect(res.headers.get("location")).toBe("http://localhost/");
    expect(exchangeCodeMock).toHaveBeenCalledTimes(1);
    expect(exchangeCodeMock.mock.calls[0][0]).toBe(42);
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
});
