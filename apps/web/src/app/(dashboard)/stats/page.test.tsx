// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 1 }, source: "web" })),
}));
vi.mock("@/lib/date", () => ({ localToday: () => "2026-11-27" }));

const yoyMetric = { current: null, prior: null, delta: null, spark: [] };
const record = { value: null, meta: null };

vi.mock("@/lib/db", () => ({
  getAllTimeStats: vi.fn(() => ({
    workouts: 3,
    activeSeconds: 3600,
    distanceMeters: null,
    kilojoules: null,
  })),
  getYearComparison: vi.fn(() => ({
    year: 2026,
    priorYear: 2025,
    periodLabel: "Jan 1 – Nov 27",
    workouts: yoyMetric,
    distanceMeters: yoyMetric,
    activeHours: yoyMetric,
    calories: yoyMetric,
  })),
  getSportBreakdown: vi.fn(() => [
    { sport: "Running", count: 2 },
    { sport: "Box & Weights", count: 1 },
    { sport: "Unknown", count: 1 },
  ]),
  getPersonalRecords: vi.fn(() => ({
    longestSessionSec: record,
    mostKilojoules: record,
    highestStrain: record,
    biggestWeekSec: record,
    topHr: record,
    mostSessionsMonth: record,
  })),
  getMonthlyRollup: vi.fn(() => []),
}));

import * as db from "@/lib/db";
import StatsPage from "./page";

async function render() {
  return renderToStaticMarkup(await StatsPage({ searchParams: Promise.resolve({}) }));
}

afterEach(() => vi.unstubAllEnvs());

describe("Stats page sport rows (issue #430)", () => {
  it("links each sport row to its encoded drill-down, carrying the range", async () => {
    const html = renderToStaticMarkup(
      await StatsPage({ searchParams: Promise.resolve({ range: "90d" }) }),
    );
    expect(html).toContain('href="/stats/Running?range=90d"');
    expect(html).toContain('href="/stats/Box%20%26%20Weights?range=90d"');
    expect(html).toContain('href="/stats/Unknown?range=90d"');
    expect(html.match(/class="sport-row"/g)).toHaveLength(3);
  });

  it("defaults to the year range when none is selected", async () => {
    const html = renderToStaticMarkup(await StatsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('href="/stats/Running?range=year"');
  });
});

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
