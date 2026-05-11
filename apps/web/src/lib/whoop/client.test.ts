// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// getValidAccessToken is the only token-touching helper `whoopGet` reaches —
// mock it so the test can deterministically return distinct tokens for the
// first (force=false) and second (force=true, 401-retry) call.
const getValidAccessTokenMock =
  vi.fn<
    (
      userId: number,
      force?: boolean,
      hooks?: { onRefresh?: () => void },
    ) => Promise<string | null>
  >();

vi.mock("./token", () => ({
  getValidAccessToken: (
    userId: number,
    force?: boolean,
    hooks?: { onRefresh?: () => void },
  ) => getValidAccessTokenMock(userId, force, hooks),
}));

// Stub global fetch per-test so the harness can sequence 401 → 200 responses.
const fetchMock = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>();

beforeEach(() => {
  getValidAccessTokenMock.mockReset();
  fetchMock.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).fetch;
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("whoopGet 401-retry path", () => {
  it("retries once with a force-refreshed token on 401, then succeeds", async () => {
    const { whoopGet } = await import("./client");

    // First call: getValidAccessToken returns stale token. Second call:
    // force=true returns a fresh token. Order matters — the assert below
    // checks both invocations.
    getValidAccessTokenMock
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValueOnce("fresh-token");

    // First fetch: 401. Second fetch: 200 with payload.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse({ records: [{ id: 1 }] }, 200));

    const result = await whoopGet<{ records: { id: number }[] }>(
      "/v2/recovery",
      { userId: 42 },
    );

    expect(result).toEqual({ records: [{ id: 1 }] });

    // getValidAccessToken called twice: first with force=false (or
    // undefined), second with force=true after the 401.
    expect(getValidAccessTokenMock).toHaveBeenCalledTimes(2);
    const firstCall = getValidAccessTokenMock.mock.calls[0];
    const secondCall = getValidAccessTokenMock.mock.calls[1];
    expect(firstCall[0]).toBe(42);
    expect(firstCall[1] ?? false).toBe(false);
    expect(secondCall[0]).toBe(42);
    expect(secondCall[1]).toBe(true);

    // Two fetches with different Authorization headers (stale → fresh).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = (fetchMock.mock.calls[0][1] as RequestInit).headers as
      | Record<string, string>
      | undefined;
    const secondHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as
      | Record<string, string>
      | undefined;
    expect(firstHeaders?.Authorization).toBe("Bearer stale-token");
    expect(secondHeaders?.Authorization).toBe("Bearer fresh-token");
  });

  it("throws WhoopAuthError when the force-refresh also returns no token", async () => {
    const { whoopGet, WhoopAuthError } = await import("./client");

    getValidAccessTokenMock
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValueOnce(null);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "unauthorized" }, 401),
    );

    await expect(whoopGet("/v2/recovery", { userId: 42 })).rejects.toBeInstanceOf(
      WhoopAuthError,
    );

    // Only one fetch — the retry short-circuits on the null token.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forwards userId into getValidAccessToken", async () => {
    const { whoopGet } = await import("./client");

    getValidAccessTokenMock.mockResolvedValueOnce("ok-token");
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }, 200));

    await whoopGet("/v2/recovery", { userId: 7 });

    expect(getValidAccessTokenMock.mock.calls[0][0]).toBe(7);
  });
});
