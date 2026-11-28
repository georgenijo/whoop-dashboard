// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// token.ts pulls client credentials + persistence helpers from `@/lib/auth`.
// Mock the whole module: `clientId`/`clientSecret` just need to return
// stable strings, `computeExpiresAtIso` needs to be deterministic, and
// `saveTokens` is spied on so success-path tests can assert it was called
// (the actual needs_reauth=0 reset is proven at the DB layer in
// integrations.test.ts — "upsertIntegration resets needs_reauth to false on
// every write" — this file only needs to prove token.ts delegates to it).
const saveTokensMock = vi.fn<(userId: number, tokens: unknown) => Promise<void>>();

vi.mock("@/lib/auth", () => ({
  clientId: () => "test-client-id",
  clientSecret: () => "test-client-secret",
  computeExpiresAtIso: (expiresIn: number) =>
    new Date(Date.now() + expiresIn * 1000).toISOString(),
  saveTokens: (userId: number, tokens: unknown) => saveTokensMock(userId, tokens),
  WHOOP_TOKEN_URL: "https://api.prod.whoop.com/oauth/oauth2/token",
}));

// token.ts reads the stored row via getIntegration and flips the flag via
// setIntegrationNeedsReauth — both mocked so the test never touches SQLite.
const getIntegrationMock = vi.fn();
const setIntegrationNeedsReauthMock = vi.fn();

vi.mock("@/lib/db/integrations", () => ({
  getIntegration: (...args: unknown[]) => getIntegrationMock(...args),
  setIntegrationNeedsReauth: (...args: unknown[]) =>
    setIntegrationNeedsReauthMock(...args),
}));

// The reauth push (#287) is mocked so these tests assert WHEN it fires; its
// own behaviour (flag modes, debounce, APNs fan-out) lives in
// reauth-push.test.ts.
const notifyWhoopNeedsReauthMock = vi.fn(async () => ({ status: "disabled" }));
vi.mock("@/lib/whoop/reauth-push", () => ({
  notifyWhoopNeedsReauth: (...args: unknown[]) =>
    notifyWhoopNeedsReauthMock(...(args as [])),
}));

const fetchMock = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>();

const STORED_INTEGRATION = {
  user_id: 1,
  provider: "whoop",
  access_token: "old-access-token",
  refresh_token: "old-refresh-token",
  // Already-expired so `getValidAccessToken(userId)` (forceRefresh=false)
  // triggers a refresh without needing to pass forceRefresh explicitly.
  expires_at: new Date(Date.now() - 60_000).toISOString(),
  scope: "offline read:recovery",
  token_type: "bearer",
  raw: { expires_in: 3600 },
  key_version: 1,
  needs_reauth: false,
  provider_user_id: null,
  updated_at: new Date().toISOString(),
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  saveTokensMock.mockReset();
  getIntegrationMock.mockReset();
  setIntegrationNeedsReauthMock.mockReset();
  // Default: the flag write is a real 0→1 transition.
  setIntegrationNeedsReauthMock.mockReturnValue(true);
  notifyWhoopNeedsReauthMock.mockClear();
  getIntegrationMock.mockReturnValue(STORED_INTEGRATION);
  saveTokensMock.mockResolvedValue(undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).fetch;
  // The exchangeCode test stubs WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET; restore
  // so this file can't leak credentials-shaped env into other suites.
  vi.unstubAllEnvs();
});

describe("getValidAccessToken → refreshTokens reauth detection", () => {
  it("pushes once on the 0→1 transition (#287)", async () => {
    const { getValidAccessToken } = await import("./token");
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, 400));
    await getValidAccessToken(1);
    expect(notifyWhoopNeedsReauthMock).toHaveBeenCalledTimes(1);
    expect(notifyWhoopNeedsReauthMock).toHaveBeenCalledWith(1);
  });

  it("does not push when the flag was already set (1→1, #287)", async () => {
    const { getValidAccessToken } = await import("./token");
    setIntegrationNeedsReauthMock.mockReturnValue(false);
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, 400));
    await getValidAccessToken(1);
    expect(setIntegrationNeedsReauthMock).toHaveBeenCalledWith(1, "whoop", true);
    expect(notifyWhoopNeedsReauthMock).not.toHaveBeenCalled();
  });

  it("does not push on a successful refresh (1→0 recovery, #287)", async () => {
    const { getValidAccessToken } = await import("./token");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { access_token: "new-a", refresh_token: "new-r", expires_in: 3600 },
        200,
      ),
    );
    expect(await getValidAccessToken(1)).toBe("new-a");
    expect(notifyWhoopNeedsReauthMock).not.toHaveBeenCalled();
  });

  it("does not push on transient 5xx (#287)", async () => {
    const { getValidAccessToken } = await import("./token");
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
    await getValidAccessToken(1);
    expect(notifyWhoopNeedsReauthMock).not.toHaveBeenCalled();
  });

  it("flips needs_reauth on 400 invalid_request from the refresh grant (Whoop's dead-token signal, #263/#414)", async () => {
    const { getValidAccessToken } = await import("./token");

    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: "invalid_request",
          error_hint: "redirect_uri whitelist mismatch (misleading per #263)",
        },
        400,
      ),
    );

    const token = await getValidAccessToken(1);

    expect(token).toBeNull();
    expect(setIntegrationNeedsReauthMock).toHaveBeenCalledWith(1, "whoop", true);
    expect(saveTokensMock).not.toHaveBeenCalled();

    // Confirm the request that produced this response was in fact the
    // refresh_token grant — the scoping this test is meant to guard.
    const [, init] = fetchMock.mock.calls[0];
    const sentBody = String((init as RequestInit).body);
    expect(new URLSearchParams(sentBody).get("grant_type")).toBe(
      "refresh_token",
    );
  });

  it("does not flip needs_reauth for invalid_request on the authorization_code exchange (exchangeCode doesn't share this detection code at all)", async () => {
    // exchangeCode is the authorization_code grant (real fetch call, using
    // the actual `@/lib/auth` implementation, not the top-of-file mock).
    // It's a structurally different function from `refreshTokens` — it just
    // throws on !resp.ok and never touches the reauth classification or
    // setIntegrationNeedsReauth. Driving it end-to-end with a 400
    // invalid_request response proves the "scoped to refresh grant" claim
    // isn't just an error-code check: this path can't reach the flag at all.
    // Kept even though the classification sets are now lexically scoped
    // inside `refreshTokens`: this is a regression guard for a future
    // refactor that routes the code exchange through shared detection logic,
    // and it covers a real user-facing scenario (a failed OAuth callback must
    // not raise the reconnect banner). `@/lib/db/integrations` is mocked for
    // the whole module graph, so the assertion would fire if exchangeCode
    // ever started importing it.
    vi.stubEnv("WHOOP_CLIENT_ID", "test-client-id");
    vi.stubEnv("WHOOP_CLIENT_SECRET", "test-client-secret");

    const { exchangeCode } = await vi.importActual<typeof import("@/lib/auth")>(
      "@/lib/auth",
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "invalid_request", error_description: "bad code" }, 400),
    );

    await expect(exchangeCode(1, "some-auth-code")).rejects.toThrow(
      /Token exchange failed \(400\)/,
    );

    expect(setIntegrationNeedsReauthMock).not.toHaveBeenCalled();
  });

  it.each(["invalid_client", "unauthorized_client"])(
    "does not flip needs_reauth on 401 %s — that's our client credentials, and reconnecting uses the same ones",
    async (errorCode) => {
      const { getValidAccessToken } = await import("./token");

      fetchMock.mockResolvedValueOnce(jsonResponse({ error: errorCode }, 401));

      const token = await getValidAccessToken(1);

      expect(token).toBeNull();
      expect(setIntegrationNeedsReauthMock).not.toHaveBeenCalled();
    },
  );

  it("flips needs_reauth on a bare 401 with no parsable error code", async () => {
    // With invalid_client / unauthorized_client peeled off above, a 401 whose
    // body we can't classify is most likely a dead grant — keep flagging it.
    const { getValidAccessToken } = await import("./token");

    fetchMock.mockResolvedValueOnce(
      new Response("<html>gateway says no</html>", {
        status: 401,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const token = await getValidAccessToken(1);

    expect(token).toBeNull();
    expect(setIntegrationNeedsReauthMock).toHaveBeenCalledWith(1, "whoop", true);
  });

  it("does not flip needs_reauth on 400 invalid_client (config error, non-401 status)", async () => {
    const { getValidAccessToken } = await import("./token");

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "invalid_client" }, 400),
    );

    const token = await getValidAccessToken(1);

    expect(token).toBeNull();
    expect(setIntegrationNeedsReauthMock).not.toHaveBeenCalled();
  });

  it.each(["invalid_grant", "invalid_token"])(
    "still flips needs_reauth on %s (no regression)",
    async (errorCode) => {
      const { getValidAccessToken } = await import("./token");

      fetchMock.mockResolvedValueOnce(jsonResponse({ error: errorCode }, 400));

      const token = await getValidAccessToken(1);

      expect(token).toBeNull();
      expect(setIntegrationNeedsReauthMock).toHaveBeenCalledWith(
        1,
        "whoop",
        true,
      );
    },
  );

  it("does not flip needs_reauth on 500", async () => {
    const { getValidAccessToken } = await import("./token");

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "server_error" }, 500),
    );

    const token = await getValidAccessToken(1);

    expect(token).toBeNull();
    expect(setIntegrationNeedsReauthMock).not.toHaveBeenCalled();
  });

  it("does not flip needs_reauth on a network error", async () => {
    const { getValidAccessToken } = await import("./token");

    fetchMock.mockRejectedValueOnce(new Error("fetch failed: ECONNRESET"));

    const token = await getValidAccessToken(1);

    expect(token).toBeNull();
    expect(setIntegrationNeedsReauthMock).not.toHaveBeenCalled();
  });

  it("does not flip needs_reauth on an unparseable (non-JSON) error body", async () => {
    const { getValidAccessToken } = await import("./token");

    fetchMock.mockResolvedValueOnce(
      new Response("<html>not json</html>", {
        status: 400,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const token = await getValidAccessToken(1);

    expect(token).toBeNull();
    expect(setIntegrationNeedsReauthMock).not.toHaveBeenCalled();
  });

  it("does not flip needs_reauth on a successful refresh, and persists via saveTokens", async () => {
    const { getValidAccessToken } = await import("./token");

    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
          token_type: "bearer",
          scope: "offline read:recovery",
        },
        200,
      ),
    );

    const token = await getValidAccessToken(1);

    expect(token).toBe("new-access-token");
    expect(setIntegrationNeedsReauthMock).not.toHaveBeenCalled();
    expect(saveTokensMock).toHaveBeenCalledTimes(1);
    const [savedUserId, savedTokens] = saveTokensMock.mock.calls[0];
    expect(savedUserId).toBe(1);
    expect((savedTokens as { access_token: string }).access_token).toBe(
      "new-access-token",
    );
  });
});
