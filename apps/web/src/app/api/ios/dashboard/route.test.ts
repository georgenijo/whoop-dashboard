import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initIosTestDb, makeIosRequest } from "../_helpers.test";
import { rmSync } from "node:fs";

vi.mock("server-only", () => ({}));

// after() only works inside a Next request scope; capture callbacks so tests
// decide whether and when the scheduled generation runs.
const scheduled = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => { scheduled.push(fn); } };
});
const sdk = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: sdk.create }; },
}));
vi.mock("@/lib/coach/model-resolution", () => ({
  resolveCatalogModel: vi.fn(async () => ({ model: "test-model", option: null })),
}));
let apiKey: string | null = "test-key";
vi.mock("@/lib/coach/api-key", () => ({
  resolveApiKeyForUser: vi.fn(() => {
    if (apiKey === null) throw new Error("no key");
    return { key: apiKey, origin: "user" as const };
  }),
}));

// Mock state — outer-scope mutability so the suite can flip auth on/off
// without re-importing the module.
let authShouldReject = false;
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => {
    if (authShouldReject) {
      throw new Response("Unauthorized", { status: 401 });
    }
    return {
      user: { id: 1, email: "t@example.com", name: null, apple_sub: "s", timezone: null },
      source: "ios" as const,
    };
  }),
}));

const testDb = initIosTestDb("ios-dashboard-db");

type RouteModule = typeof import("./route");
let route: RouteModule;

beforeAll(async () => {
  // Force schema bootstrap by writing through openWrite() via settings.
  const settings = await import("@/lib/db/settings");
  settings.setSetting("test_bootstrap", "1");
  route = await import("./route");
  testDb.reset();
});

beforeEach(() => {
  authShouldReject = false;
  apiKey = "test-key";
  scheduled.length = 0;
  sdk.create.mockReset();
  testDb.reset();
  const d = testDb.db();
  try {
    d.prepare("DELETE FROM insights WHERE user_id = 1").run();
    d.prepare("DELETE FROM ai_generation_state WHERE user_id = 1").run();
    d.prepare("DELETE FROM app_settings WHERE key LIKE '%generation%'").run();
  } finally {
    d.close();
  }
});

afterAll(() => {
  rmSync(testDb.tmpRoot, { recursive: true, force: true });
});

describe("GET /api/ios/dashboard", () => {
  it("returns 200 with the expected shape on a seeded DB", async () => {
    testDb.seedRecovery("2026-05-10", { score: 75, hrv: 60, rhr: 50, spo2: 97 });
    testDb.seedRecovery("2026-05-09", { score: 70, hrv: 55, rhr: 52, spo2: 96 });
    testDb.seedCycle("2026-05-10", { strain: 12.5 });
    testDb.seedSleep("2026-05-10", { in_bed_ms: 8 * 3_600_000, performance: 90 });

    const res = await route.GET(makeIosRequest("/api/ios/dashboard?range=30d"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body).toHaveProperty("data_date");
    expect(body).toHaveProperty("is_fallback");
    expect(body).toHaveProperty("recovery_hero");
    expect(body).toHaveProperty("kpi");
    expect(body).toHaveProperty("prs");
    expect(body).toHaveProperty("recovery_trend");

    const kpi = body.kpi as unknown[];
    expect(kpi).toHaveLength(7);

    const hero = body.recovery_hero as Record<string, unknown>;
    expect(hero.score).toBe(75);
    expect(hero.hrv_ms).toBe(60);
    expect(hero.rhr_bpm).toBe(50);
  });

  it("returns 401 when auth rejects", async () => {
    authShouldReject = true;
    const res = await route.GET(makeIosRequest("/api/ios/dashboard?range=30d"));
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid range", async () => {
    const res = await route.GET(makeIosRequest("/api/ios/dashboard?range=bogus"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toMatch(/range/i);
  });

  it("returns null/empty fields on empty DB", async () => {
    const res = await route.GET(makeIosRequest("/api/ios/dashboard?range=30d"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.data_date).toBeNull();
    expect(body.is_fallback).toBe(false);
    const hero = body.recovery_hero as Record<string, unknown>;
    expect(hero.score).toBeNull();
    expect(hero.hrv_ms).toBeNull();
    expect(body.ai_insight).toBeNull();
    expect(body.recovery_trend).toEqual([]);
    const kpi = body.kpi as Array<Record<string, unknown>>;
    expect(kpi).toHaveLength(7);
    for (const t of kpi) {
      expect(t.value).toBeNull();
      expect(t.delta).toBeNull();
    }
    const prs = body.prs as Record<string, unknown>;
    expect(prs.best_hrv).toBeNull();
    expect(prs.lowest_rhr).toBeNull();
  });

  describe("daily brief generation", () => {
    const get = async () =>
      (await (await route.GET(makeIosRequest("/api/ios/dashboard?range=30d"))).json()) as Record<string, unknown>;
    const seedData = () => testDb.seedRecovery("2026-05-10", { score: 75, hrv: 60, rhr: 50, spo2: 97 });

    it("schedules generation once when stale and reports refreshing without waiting for the model", async () => {
      seedData();
      sdk.create.mockReturnValue(new Promise(() => {})); // never settles
      const body = await get();
      expect(body.insight_refreshing).toBe(true);
      expect(body.insight_error).toBeNull();
      expect(body.ai_insight).toBeNull();
      expect(scheduled).toHaveLength(1);
      expect(sdk.create).not.toHaveBeenCalled();
    });

    it("schedules nothing and reports not refreshing when the brief is fresh", async () => {
      seedData();
      const { saveInsight } = await import("@/lib/db/summary");
      const { insightToday } = await import("@/lib/insights");
      saveInsight(1, insightToday(1), "Fresh brief");
      const body = await get();
      expect(body.insight_refreshing).toBe(false);
      expect(body.insight_error).toBeNull();
      expect(body.ai_insight).toMatchObject({ text: "Fresh brief", is_stale: false });
      expect(scheduled).toHaveLength(0);
    });

    it("does not schedule a second generation while the lock is held, and still reports refreshing", async () => {
      seedData();
      sdk.create.mockReturnValue(new Promise(() => {}));
      expect((await get()).insight_refreshing).toBe(true);
      const second = await get();
      expect(second.insight_refreshing).toBe(true);
      expect(scheduled).toHaveLength(1);
    });

    it("honors backoff after a failed generation and exposes the error class", async () => {
      seedData();
      sdk.create.mockRejectedValue(new Error("provider unavailable"));
      expect((await get()).insight_refreshing).toBe(true);
      await scheduled[0]();
      for (let i = 0; i < 5; i++) {
        const body = await get();
        expect(body.insight_refreshing).toBe(false);
        expect(body.insight_error).toBe("provider_error");
      }
      expect(scheduled).toHaveLength(1);
      expect(sdk.create).toHaveBeenCalledTimes(1);
    });

    it("persists a visible no_key failure instead of throwing", async () => {
      seedData();
      apiKey = null;
      const res = await route.GET(makeIosRequest("/api/ios/dashboard?range=30d"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.insight_refreshing).toBe(false);
      expect(body.insight_error).toBe("no_key");
      expect(scheduled).toHaveLength(0);
      expect(sdk.create).not.toHaveBeenCalled();
    });

    it("reports no refresh and no error on an empty DB", async () => {
      const body = await get();
      expect(body.insight_refreshing).toBe(false);
      expect(body.insight_error).toBeNull();
      expect(scheduled).toHaveLength(0);
    });
  });
});
