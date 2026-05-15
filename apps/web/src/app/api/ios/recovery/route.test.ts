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

const testDb = initIosTestDb("ios-recovery-db");

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

describe("GET /api/ios/recovery", () => {
  it("returns 200 + valid shape on seeded DB", async () => {
    for (let i = 0; i < 30; i++) {
      const d = new Date(2026, 4, 1 + i).toISOString().slice(0, 10);
      testDb.seedRecovery(d, { score: 70 + i, hrv: 50 + i, rhr: 55 - i / 4, spo2: 97 + (i % 3) * 0.2 });
    }

    const res = await route.GET(makeIosRequest("/api/ios/recovery?range=30d"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.range_label).toBe("30 days");
    expect(body.kpi).toHaveProperty("length", 6);
    expect(body.recovery_trend).toBeInstanceOf(Array);
    const recovery_trend = body.recovery_trend as Array<Record<string, unknown>>;
    expect(recovery_trend.length).toBe(30);
    expect(recovery_trend[0]).toHaveProperty("date");
    expect(recovery_trend[0]).toHaveProperty("raw");
    expect(recovery_trend[0]).toHaveProperty("ma7");
    expect(recovery_trend[0]).toHaveProperty("ma30");

    const hrv_trend = body.hrv_trend as Record<string, unknown>;
    expect(hrv_trend).toHaveProperty("points");
    expect(hrv_trend).toHaveProperty("anomalies");

    const spo2 = body.spo2_trend as Record<string, unknown>;
    expect(spo2.avg).toBeTypeOf("number");
    expect(spo2.y_min).toBeTypeOf("number");
    expect(spo2.y_max).toBeTypeOf("number");
  });

  it("returns 401 when auth rejects", async () => {
    authShouldReject = true;
    const res = await route.GET(makeIosRequest("/api/ios/recovery?range=30d"));
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid range", async () => {
    const res = await route.GET(makeIosRequest("/api/ios/recovery?range=junk"));
    expect(res.status).toBe(400);
  });

  it("returns empty arrays on empty DB", async () => {
    const res = await route.GET(makeIosRequest("/api/ios/recovery?range=30d"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.recovery_trend).toEqual([]);
    const hrv = body.hrv_trend as Record<string, unknown>;
    expect(hrv.points).toEqual([]);
    expect(hrv.anomalies).toEqual([]);
    expect(body.rhr_trend).toEqual([]);
    expect(body.spo2_trend).toBeNull();
  });
});
