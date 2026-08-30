import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initIosTestDb, makeIosRequest } from "../_helpers.test";
import { rmSync } from "node:fs";
import { localToday } from "@/lib/ios/range";
import { shiftDate } from "@/lib/range";

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

const testDb = initIosTestDb("ios-workouts-db");

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

describe("GET /api/ios/workouts", () => {
  it("returns 200 + shape on seeded DB; sport_frequency and zone_breakdown computed", async () => {
    const today = localToday();
    testDb.seedWorkout("w1", today, {
      sport: "running",
      duration_sec: 1800,
      strain: 9,
      kilojoule: 2000,
      distance_m: 5000,
      zone_0_ms: 300_000,
      zone_1_ms: 300_000,
      zone_2_ms: 600_000,
      zone_3_ms: 400_000,
      zone_4_ms: 200_000,
      zone_5_ms: 0,
    });
    testDb.seedWorkout("w2", today, {
      sport: "cycling",
      duration_sec: 3600,
      strain: 12,
      kilojoule: 4000,
      distance_m: 20000,
    });

    const res = await route.GET(makeIosRequest("/api/ios/workouts?range=30d"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.range_label).toBe("30 days");
    expect(body.total_count).toBe(2);
    expect(body.truncated).toBe(false);

    const freq = body.sport_frequency as Array<Record<string, unknown>>;
    expect(freq.length).toBe(2);
    for (const f of freq) {
      expect(f).toHaveProperty("color_hex");
      expect(f).toHaveProperty("sessions");
      expect(f).toHaveProperty("kj");
      expect(f).toHaveProperty("duration_min");
    }

    const zones = body.zone_breakdown_recent as Array<Record<string, unknown>>;
    expect(zones.length).toBe(1); // only w1 has zone data
    const w1Zones = zones[0].zones as Record<string, unknown>;
    expect(w1Zones.total_ms).toBe(1_800_000);
    // z2 was 600_000ms out of 1_800_000 -> 33.33%
    expect(w1Zones.z2_pct).toBeCloseTo(33.333, 2);

    const dist = body.distance_recent as Array<Record<string, unknown>>;
    expect(dist.length).toBe(2);
    expect(dist[0]).toHaveProperty("distance_km");
  });

  it("returns 401 when auth rejects", async () => {
    authShouldReject = true;
    const res = await route.GET(makeIosRequest("/api/ios/workouts?range=30d"));
    expect(res.status).toBe(401);
  });

  it("returns all chart rows in the selected window and excludes older rows", async () => {
    const today = localToday();
    testDb.seedWorkout("outside", shiftDate(today, -7), {
      sport: "running",
      distance_m: 1000,
      zone_2_ms: 60_000,
    });
    for (let i = 0; i < 7; i++) {
      testDb.seedWorkout(`inside-${i}`, shiftDate(today, -i), {
        sport: "running",
        distance_m: 1000 + i,
        zone_2_ms: 60_000,
      });
    }

    const res = await route.GET(makeIosRequest("/api/ios/workouts?range=7d"));
    const body = (await res.json()) as {
      zone_breakdown_recent: unknown[];
      distance_recent: unknown[];
      workouts: { id: string }[];
    };

    expect(body.zone_breakdown_recent).toHaveLength(7);
    expect(body.distance_recent).toHaveLength(7);
    expect(body.workouts.map((row) => row.id)).not.toContain("outside");
  });

  it("returns 400 on invalid range", async () => {
    const res = await route.GET(makeIosRequest("/api/ios/workouts?range=foo"));
    expect(res.status).toBe(400);
  });

  it("returns empty arrays on empty DB", async () => {
    const res = await route.GET(makeIosRequest("/api/ios/workouts?range=30d"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.total_count).toBe(0);
    expect(body.truncated).toBe(false);
    expect(body.sport_frequency).toEqual([]);
    expect(body.zone_breakdown_recent).toEqual([]);
    expect(body.distance_recent).toEqual([]);
    expect(body.workouts).toEqual([]);
  });
});
