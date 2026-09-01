import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initIosTestDb, makeIosRequest } from "../_helpers.test";
import { rmSync } from "node:fs";

vi.mock("server-only", () => ({}));

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
  testDb.reset();
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
});
