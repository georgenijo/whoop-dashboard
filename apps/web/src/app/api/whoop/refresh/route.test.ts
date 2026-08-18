// @vitest-environment node
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listIntegrationUserIdsMock = vi.fn<
  (provider: string, opts?: { activeOnly?: boolean }) => number[]
>();
const getValidAccessTokenMock = vi.fn<
  (userId: number, forceRefresh?: boolean) => Promise<string | null>
>();
const addSyncLogMock = vi.fn();

const logMock = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
};

vi.mock("@/lib/db/integrations", () => ({
  listIntegrationUserIds: (provider: string, opts?: { activeOnly?: boolean }) =>
    listIntegrationUserIdsMock(provider, opts),
}));

vi.mock("@/lib/db/logs", () => ({
  addSyncLog: (log: unknown) => addSyncLogMock(log),
  KEEPALIVE_SYNC_SOURCE: "keepalive",
}));

vi.mock("@/lib/logger", () => ({
  forModule: () => logMock,
}));

vi.mock("@/lib/whoop/token", () => ({
  getValidAccessToken: (userId: number, forceRefresh?: boolean) =>
    getValidAccessTokenMock(userId, forceRefresh),
}));

const SECRET = "test-refresh-secret-value";

type RouteModule = typeof import("./route");
let route: RouteModule;

function makeRequest(authorization?: string): Request {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new Request("http://127.0.0.1:8501/api/whoop/refresh", {
    method: "POST",
    headers,
  });
}

beforeEach(async () => {
  vi.resetModules();
  listIntegrationUserIdsMock.mockReset();
  getValidAccessTokenMock.mockReset();
  addSyncLogMock.mockReset();
  logMock.debug.mockReset();
  logMock.info.mockReset();
  logMock.warn.mockReset();
  logMock.error.mockReset();
  logMock.fatal.mockReset();
  listIntegrationUserIdsMock.mockReturnValue([]);
  delete process.env.WHOOP_REFRESH_SECRET;
  route = await import("./route");
});

afterEach(() => {
  delete process.env.WHOOP_REFRESH_SECRET;
});

describe("POST /api/whoop/refresh — fail-closed secret gate", () => {
  it("returns 404 when WHOOP_REFRESH_SECRET is unset", async () => {
    const res = await route.POST(makeRequest(`Bearer ${SECRET}`));
    expect(res.status).toBe(404);
    expect(listIntegrationUserIdsMock).not.toHaveBeenCalled();
  });

  it("returns 404 when WHOOP_REFRESH_SECRET is set to an empty string", async () => {
    process.env.WHOOP_REFRESH_SECRET = "";
    const res = await route.POST(makeRequest(`Bearer ${SECRET}`));
    expect(res.status).toBe(404);
  });

  it("returns 401 when Authorization header is missing", async () => {
    process.env.WHOOP_REFRESH_SECRET = SECRET;
    const res = await route.POST(makeRequest());
    expect(res.status).toBe(401);
    expect(listIntegrationUserIdsMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the bearer token is wrong (same length)", async () => {
    process.env.WHOOP_REFRESH_SECRET = SECRET;
    const wrongSameLength = "x".repeat(SECRET.length);
    const res = await route.POST(makeRequest(`Bearer ${wrongSameLength}`));
    expect(res.status).toBe(401);
    expect(listIntegrationUserIdsMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the bearer token is wrong (different length)", async () => {
    process.env.WHOOP_REFRESH_SECRET = SECRET;
    const res = await route.POST(makeRequest("Bearer short"));
    expect(res.status).toBe(401);
  });

  it("returns 401 for a malformed Authorization header (no Bearer scheme)", async () => {
    process.env.WHOOP_REFRESH_SECRET = SECRET;
    const res = await route.POST(makeRequest(SECRET));
    expect(res.status).toBe(401);
  });
});

describe("secretMatches — constant-time-shaped compare", () => {
  it("invokes crypto.timingSafeEqual (not a short-circuiting ===) to detect a mismatch", () => {
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    try {
      const result = route.secretMatches("aaaaaaaa", "aaaaaaab");
      expect(result).toBe(false);
      // This only proves the constant-time primitive was invoked at all —
      // it does not (and a unit test cannot) prove actual wall-clock timing
      // is constant. It rules out the regression of quietly swapping in a
      // plain `===`, which would never call timingSafeEqual.
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("guards the length check so mismatched lengths never reach timingSafeEqual (which throws on them)", () => {
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    try {
      expect(() => route.secretMatches("short", "a-much-longer-secret")).not.toThrow();
      expect(route.secretMatches("short", "a-much-longer-secret")).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("returns true only for an exact match", () => {
    expect(route.secretMatches(SECRET, SECRET)).toBe(true);
  });
});

describe("POST /api/whoop/refresh — refresh fan-out", () => {
  beforeEach(() => {
    process.env.WHOOP_REFRESH_SECRET = SECRET;
  });

  it("attempts a force-refresh for every active (non-needs_reauth) user with a whoop integration row", async () => {
    listIntegrationUserIdsMock.mockReturnValue([1, 2, 3]);
    getValidAccessTokenMock.mockResolvedValue("access-token");

    const res = await route.POST(makeRequest(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    expect(listIntegrationUserIdsMock).toHaveBeenCalledWith("whoop", {
      activeOnly: true,
    });
    expect(getValidAccessTokenMock).toHaveBeenCalledTimes(3);
    for (const userId of [1, 2, 3]) {
      expect(getValidAccessTokenMock).toHaveBeenCalledWith(userId, true);
    }
    const body = (await res.json()) as {
      ok: boolean;
      total: number;
      refreshed: number;
      failed: number;
    };
    expect(body).toMatchObject({ ok: true, total: 3, refreshed: 3, failed: 0 });
    // Every attempted user gets a durable, /logs-visible sync_logs row.
    expect(addSyncLogMock).toHaveBeenCalledTimes(3);
    for (const call of addSyncLogMock.mock.calls) {
      expect(call[0]).toMatchObject({ status: "ok", source: "keepalive" });
    }
  });

  it("one user's refresh failing does not prevent the others from being refreshed, and flips the response non-200", async () => {
    listIntegrationUserIdsMock.mockReturnValue([1, 2, 3]);
    getValidAccessTokenMock.mockImplementation(async (userId: number) => {
      if (userId === 2) throw new Error("boom — simulated DB hiccup for user 2");
      return "access-token";
    });

    const res = await route.POST(makeRequest(`Bearer ${SECRET}`));

    // A real failure must not report success to curl --fail / systemd —
    // this is the core of BLOCK 3: a dead integration must not look OK.
    expect(res.status).toBe(502);
    expect(getValidAccessTokenMock).toHaveBeenCalledTimes(3);
    const body = (await res.json()) as {
      ok: boolean;
      total: number;
      refreshed: number;
      failed: number;
      users: { user_id: number; ok: boolean }[];
    };
    expect(body.ok).toBe(false);
    expect(body.total).toBe(3);
    expect(body.refreshed).toBe(2);
    expect(body.failed).toBe(1);
    expect(body.users).toEqual(
      expect.arrayContaining([
        { user_id: 1, ok: true },
        { user_id: 2, ok: false },
        { user_id: 3, ok: true },
      ]),
    );
    // The failing user's unexpected throw is logged loudly, not swallowed.
    expect(logMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 2 }),
      expect.stringContaining("unexpected error"),
    );
    // And a durable per-user record exists for all three, including the
    // failure — this is what makes it visible on /logs instead of only in
    // journald.
    expect(addSyncLogMock).toHaveBeenCalledTimes(3);
    const failedLogCall = addSyncLogMock.mock.calls.find(
      (call) => (call[0] as { user_id: number }).user_id === 2,
    );
    expect(failedLogCall?.[0]).toMatchObject({
      status: "error",
      source: "keepalive",
    });
    expect((failedLogCall?.[0] as { error_message: string }).error_message).toContain(
      "boom",
    );
  });

  it("treats a null token (refresh rejected upstream) as a per-user failure, not a thrown error, and still flips the response non-200", async () => {
    listIntegrationUserIdsMock.mockReturnValue([1]);
    getValidAccessTokenMock.mockResolvedValue(null);

    const res = await route.POST(makeRequest(`Bearer ${SECRET}`));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; refreshed: number; failed: number };
    expect(body.ok).toBe(false);
    expect(body.refreshed).toBe(0);
    expect(body.failed).toBe(1);
  });

  it("returns non-200 when there are no active integrations to refresh at all", async () => {
    listIntegrationUserIdsMock.mockReturnValue([]);

    const res = await route.POST(makeRequest(`Bearer ${SECRET}`));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; total: number };
    expect(body.ok).toBe(false);
    expect(body.total).toBe(0);
    expect(addSyncLogMock).not.toHaveBeenCalled();
  });

  it("response body carries only user ids and booleans — no access/refresh tokens", async () => {
    listIntegrationUserIdsMock.mockReturnValue([1]);
    getValidAccessTokenMock.mockResolvedValue("super-secret-access-token-value");

    const res = await route.POST(makeRequest(`Bearer ${SECRET}`));
    const text = await res.text();
    expect(text).not.toContain("super-secret-access-token-value");
    expect(text).not.toContain(SECRET);
  });

  it("a repeat call within the cooldown window is answered without refreshing again", async () => {
    listIntegrationUserIdsMock.mockReturnValue([1]);
    getValidAccessTokenMock.mockResolvedValue("access-token");

    const first = await route.POST(makeRequest(`Bearer ${SECRET}`));
    expect(first.status).toBe(200);
    expect(getValidAccessTokenMock).toHaveBeenCalledTimes(1);

    const second = await route.POST(makeRequest(`Bearer ${SECRET}`));
    expect(second.status).toBe(200);
    // Still 1 — the cooldown floor answered the second call without a
    // second Whoop round-trip.
    expect(getValidAccessTokenMock).toHaveBeenCalledTimes(1);
    const body = (await second.json()) as { skipped?: boolean };
    expect(body.skipped).toBe(true);
  });
});
