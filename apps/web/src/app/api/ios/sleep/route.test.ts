import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initIosTestDb, makeIosRequest } from "../_helpers.test";
import { rmSync } from "node:fs";

vi.mock("server-only", () => ({}));

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

const testDb = initIosTestDb("ios-sleep-db");

type RouteModule = typeof import("./route");
let route: RouteModule;

beforeAll(async () => {
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

describe("GET /api/ios/sleep", () => {
  it("returns 200 + shape on seeded DB", async () => {
    for (let i = 0; i < 7; i++) {
      const d = new Date(2026, 4, 1 + i).toISOString().slice(0, 10);
      testDb.seedSleep(d, {
        in_bed_ms: 8 * 3_600_000,
        light_ms: 3 * 3_600_000,
        deep_ms: 2 * 3_600_000,
        rem_ms: 2 * 3_600_000,
        awake_ms: 30 * 60_000,
        sleep_need_ms: 8 * 3_600_000,
        performance: 85 + i,
        efficiency: 90,
        need_from_baseline_ms: 7 * 3_600_000,
        need_from_debt_ms: 30 * 60_000,
        need_from_strain_ms: 15 * 60_000,
        need_from_nap_ms: 0,
      });
    }

    const res = await route.GET(makeIosRequest("/api/ios/sleep?range=30d"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.range_label).toBe("30 days");

    const latest = body.latest_sleep as Record<string, unknown>;
    expect(latest).not.toBeNull();
    expect(latest.stages).toMatchObject({
      light_ms: 3 * 3_600_000,
      deep_ms: 2 * 3_600_000,
      rem_ms: 2 * 3_600_000,
    });
    expect(latest.need_breakdown).toMatchObject({
      baseline_ms: 7 * 3_600_000,
    });

    const durationTrend = body.duration_trend as Array<Record<string, unknown>>;
    expect(durationTrend).toHaveLength(7);
    expect(durationTrend[0].raw_hours).toBeCloseTo(8, 6);
  });

  it("returns 401 when auth rejects", async () => {
    authShouldReject = true;
    const res = await route.GET(makeIosRequest("/api/ios/sleep?range=30d"));
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid range", async () => {
    const res = await route.GET(makeIosRequest("/api/ios/sleep?range=invalid"));
    expect(res.status).toBe(400);
  });

  it("returns null/empty fields on empty DB", async () => {
    const res = await route.GET(makeIosRequest("/api/ios/sleep?range=30d"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.latest_sleep).toBeNull();
    expect(body.duration_trend).toEqual([]);
    expect(body.performance_trend).toEqual([]);
  });
});
