// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 1 }, source: "web" })),
}));
vi.mock("@/lib/date", () => ({ localToday: () => "2026-11-27" }));
vi.mock("@/lib/db", () => {
  const metric = { current: null, prior: null, delta: null, spark: [] };
  const rec = { value: null, meta: null };
  return {
    getAllTimeStats: vi.fn(() => ({ workouts: 3, activeSeconds: 3600, distanceMeters: null, kilojoules: null })),
    getYearComparison: vi.fn(() => ({
      year: 2026,
      priorYear: 2025,
      periodLabel: "Jan 1 – Nov 27",
      workouts: metric,
      distanceMeters: metric,
      activeHours: metric,
      calories: metric,
    })),
    getSportBreakdown: vi.fn(() => []),
    getPersonalRecords: vi.fn(() => ({
      longestSessionSec: rec,
      mostKilojoules: rec,
      highestStrain: rec,
      biggestWeekSec: rec,
      topHr: rec,
      mostSessionsMonth: rec,
    })),
    getMonthlyRollup: vi.fn(() => []),
  };
});

import * as db from "@/lib/db";
import StatsPage from "./page";

async function render() {
  return renderToStaticMarkup(await StatsPage({ searchParams: Promise.resolve({}) }));
}

afterEach(() => vi.unstubAllEnvs());

describe("Stats page Year in review link", () => {
  it("is absent with YEAR_REVIEW unset", async () => {
    vi.stubEnv("YEAR_REVIEW", "");
    expect(await render()).not.toContain('href="/year"');
  });

  it("is present with YEAR_REVIEW=1", async () => {
    vi.stubEnv("YEAR_REVIEW", "1");
    expect(await render()).toContain('href="/year"');
  });

  it("also shows on the no-workouts empty state", async () => {
    vi.stubEnv("YEAR_REVIEW", "1");
    vi.mocked(db.getAllTimeStats).mockReturnValueOnce({
      workouts: 0,
      activeSeconds: null,
      distanceMeters: null,
      kilojoules: null,
    });
    const html = await render();
    expect(html).toContain("No workouts logged yet");
    expect(html).toContain('href="/year"');
  });
});
