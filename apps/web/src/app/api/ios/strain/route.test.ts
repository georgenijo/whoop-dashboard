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

const testDb = initIosTestDb("ios-strain-db");

type RouteModule = typeof import("./route");
let route: RouteModule;

function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

describe("GET /api/ios/strain", () => {
  it("returns 200 + shape on seeded DB; today aggregate populated", async () => {
    const today = localToday();
    testDb.seedCycle(today, { strain: 13.5, kilojoule: 8000, avg_hr: 75, max_hr: 160 });
    testDb.seedWorkout("w1", today, {
      sport: "running",
      duration_sec: 1800,
      avg_hr: 140,
      max_hr: 165,
      strain: 9,
      kilojoule: 2500,
      distance_m: 5000,
    });
    for (let i = 1; i <= 7; i++) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      testDb.seedCycle(d, { strain: 10 + i * 0.1, avg_hr: 70 + i });
    }

    const res = await route.GET(makeIosRequest("/api/ios/strain?range=30d"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.range_label).toBe("30 days");
    const today_block = body.today as Record<string, unknown>;
    expect(today_block.date).toBe(today);
    expect(today_block.total_kilojoule).toBe(2500);
    expect(today_block.total_kcal).toBeCloseTo(2500 * 0.239, 6);
    expect(today_block.workout_count).toBe(1);
    expect(today_block.workouts).toHaveLength(1);

    expect(body.strain_trend).toBeInstanceOf(Array);
    expect((body.strain_trend as unknown[]).length).toBeGreaterThan(0);
  });

  it("returns 401 when auth rejects", async () => {
    authShouldReject = true;
    const res = await route.GET(makeIosRequest("/api/ios/strain?range=30d"));
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid range", async () => {
    const res = await route.GET(makeIosRequest("/api/ios/strain?range=oof"));
    expect(res.status).toBe(400);
  });

  it("returns empty arrays + zero workout count on empty DB", async () => {
    const res = await route.GET(makeIosRequest("/api/ios/strain?range=30d"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const today_block = body.today as Record<string, unknown>;
    expect(today_block.workout_count).toBe(0);
    expect(today_block.workouts).toEqual([]);
    expect(today_block.total_kilojoule).toBeNull();
    expect(today_block.total_kcal).toBeNull();
    expect(body.strain_trend).toEqual([]);
    expect(body.avg_hr_trend).toEqual([]);
  });
});
