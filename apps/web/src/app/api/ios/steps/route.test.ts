import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initIosTestDb, makeIosRequest } from "../_helpers.test";
import { rmSync } from "node:fs";
import { localToday } from "@/lib/ios/range";
import { shiftDate } from "@/lib/range";

vi.mock("server-only", () => ({}));

let authShouldReject = false;
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => {
    if (authShouldReject) throw new Response("Unauthorized", { status: 401 });
    return {
      user: { id: 1, email: "t@example.com", name: null, apple_sub: "s", timezone: null },
      source: "ios" as const,
    };
  }),
}));

const testDb = initIosTestDb("ios-steps-db");
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

afterAll(() => rmSync(testDb.tmpRoot, { recursive: true, force: true }));

describe("GET /api/ios/steps", () => {
  it("returns 401 when auth rejects", async () => {
    authShouldReject = true;
    const res = await route.GET(makeIosRequest("/api/ios/steps?range=30d"));
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid range", async () => {
    const res = await route.GET(makeIosRequest("/api/ios/steps?range=bogus"));
    expect(res.status).toBe(400);
  });

  it("returns an honest empty envelope when no Apple Health sync exists", async () => {
    const res = await route.GET(makeIosRequest("/api/ios/steps?range=30d"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.range_label).toBe("30 days");
    expect(body.steps_trend).toEqual([]);
    expect(body.today).toEqual({ date: localToday(), steps: null, vs_7d_avg: null });
  });

  it("does not present a historical average as today's comparison", async () => {
    const today = localToday();
    testDb.seedSteps(shiftDate(today, -2), 4200);
    testDb.seedSteps(shiftDate(today, -1), 5100);
    const res = await route.GET(makeIosRequest("/api/ios/steps?range=30d"));
    const body = await res.json();
    expect(body.today).toEqual({ date: today, steps: null, vs_7d_avg: null });
  });

  it("does not return another user's step rows", async () => {
    const today = localToday();
    const d = testDb.db();
    d.prepare(
      "INSERT OR IGNORE INTO users (id, apple_sub, email) VALUES (?, ?, ?)",
    ).run(2, "other-sub", "other@example.com");
    d.close();
    testDb.seedSteps(today, 9900, "apple_health", 2);
    const res = await route.GET(makeIosRequest("/api/ios/steps?range=30d"));
    const body = await res.json();
    expect(body.steps_trend).toEqual([]);
    expect(body.today).toEqual({ date: today, steps: null, vs_7d_avg: null });
  });

  it("returns raw steps and trailing MA7 for seeded Apple Health data", async () => {
    const today = localToday();
    for (let i = 0; i < 7; i++) testDb.seedSteps(shiftDate(today, -(6 - i)), (i + 1) * 1000);
    const res = await route.GET(makeIosRequest("/api/ios/steps?range=30d"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.steps_trend).toHaveLength(7);
    expect(body.steps_trend[0]).toMatchObject({ date: shiftDate(today, -6), raw: 1000, ma7: 1000 });
    expect(body.steps_trend[6]).toMatchObject({ date: today, raw: 7000, ma7: 4000 });
    expect(body.today).toMatchObject({ date: today, steps: 7000, vs_7d_avg: 4000 });
    expect(body.kpi.find((tile: { key: string }) => tile.key === "steps").href).toBe("/steps");
  });

  it("scopes trend and today fields to the selected range", async () => {
    const today = localToday();
    testDb.seedSteps(shiftDate(today, -8), 8000);
    testDb.seedSteps(shiftDate(today, -6), 6000);
    testDb.seedSteps(today, 7000);
    const res = await route.GET(makeIosRequest("/api/ios/steps?range=7d"));
    const body = await res.json();
    expect(body.steps_trend.map((point: { date: string }) => point.date)).toEqual([
      shiftDate(today, -6),
      today,
    ]);
    expect(body.today).toMatchObject({ steps: 7000, vs_7d_avg: 6500 });
  });
});
