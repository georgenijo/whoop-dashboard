// @vitest-environment node
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const m = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 7 }, source: "web" })),
  getDailySummary: vi.fn(),
  getUserSettings: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound: m.notFound }));
vi.mock("@/lib/auth", () => ({ requireAuthOrSignin: m.requireAuthOrSignin }));
vi.mock("@/lib/db", () => ({
  getDailySummary: m.getDailySummary,
  getUserSettings: m.getUserSettings,
}));

import GoalsPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  m.getDailySummary.mockReturnValue([
    {
      date: "2026-11-27",
      recovery_score: 72,
      hrv_ms: 90,
      resting_hr: 52,
      sleep_hours: 7.8,
      sleep_efficiency: 92,
      sleep_performance: 88,
      day_strain: 11.2,
      max_hr: 170,
      avg_hr: 70,
      kilojoules: 9000,
      workouts_count: 1,
      computed_at: "2026-11-27T12:00:00Z",
    },
  ]);
  m.getUserSettings.mockReturnValue({ tz: "America/New_York" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("/goals page", () => {
  it.each([undefined, "", "0", "true"])("404s with GOALS_PAGE=%s before auth or any DB read", async (v) => {
    if (v === undefined) vi.stubEnv("GOALS_PAGE", undefined as unknown as string);
    else vi.stubEnv("GOALS_PAGE", v);
    await expect(GoalsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(m.requireAuthOrSignin).not.toHaveBeenCalled();
    expect(m.getDailySummary).not.toHaveBeenCalled();
    expect(m.getUserSettings).not.toHaveBeenCalled();
  });

  it("with GOALS_PAGE=1 does one bounded 90-day read of the user's own rows, dated in their zone", async () => {
    vi.stubEnv("GOALS_PAGE", "1");
    vi.useFakeTimers();
    // 03:30 UTC Nov 28 is still Nov 27 in New York.
    vi.setSystemTime(new Date("2026-11-28T03:30:00Z"));
    const el = await GoalsPage();
    expect(m.getDailySummary).toHaveBeenCalledTimes(1);
    expect(m.getDailySummary).toHaveBeenCalledWith(7, "2026-08-30", "2026-11-27");
    expect(el.props.today).toBe("2026-11-27");
    expect(el.props.weekStart).toBe(1);
    // Only the fields the goals need reach the client.
    expect(Object.keys(el.props.rows[0]).sort()).toEqual(
      ["date", "day_strain", "recovery_score", "resting_hr", "sleep_hours", "sleep_performance", "workouts_count"].sort(),
    );
    const html = renderToString(el).replace(/<!-- -->/g, "");
    // Server render never reads browser storage: it shows the loading state.
    expect(html).toContain("Loading your goals");
    expect(html).toContain("As of Nov 27");
  });

  it("falls back to UTC on an invalid stored timezone", async () => {
    vi.stubEnv("GOALS_PAGE", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-28T03:30:00Z"));
    m.getUserSettings.mockReturnValue({ tz: "Not/AZone" });
    const el = await GoalsPage();
    expect(el.props.today).toBe("2026-11-28");
  });
});
