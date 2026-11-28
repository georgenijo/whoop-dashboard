// @vitest-environment node
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const m = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 7 }, source: "web" })),
  getRecordSeries: vi.fn(),
  getPRStats: vi.fn(),
  getUserSettings: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound: m.notFound }));
vi.mock("@/lib/auth", () => ({ requireAuthOrSignin: m.requireAuthOrSignin }));
vi.mock("@/lib/db", () => ({
  getRecordSeries: m.getRecordSeries,
  getPRStats: m.getPRStats,
  getUserSettings: m.getUserSettings,
}));

import RecordsPage from "./page";

const series = {
  hrv: [{ date: "2026-11-20", value: 104 }],
  rhr: [], recovery: [], strain: [], sleepDuration: [], sleepPerformance: [], workoutDuration: [], steps: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getRecordSeries.mockReturnValue(series);
  m.getPRStats.mockReturnValue({ bestHRV: null, lowestRHR: null, recoveryStreak: null, sleepPerfStreak: null, loggingStreak: null });
  m.getUserSettings.mockReturnValue({ tz: "America/New_York" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("/records page", () => {
  it.each([undefined, "", "0", "true"])("404s with RECORDS_PAGE=%s before auth or any DB read", async (v) => {
    if (v === undefined) vi.stubEnv("RECORDS_PAGE", undefined as unknown as string);
    else vi.stubEnv("RECORDS_PAGE", v);
    await expect(RecordsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(m.requireAuthOrSignin).not.toHaveBeenCalled();
    expect(m.getRecordSeries).not.toHaveBeenCalled();
    expect(m.getPRStats).not.toHaveBeenCalled();
    expect(m.getUserSettings).not.toHaveBeenCalled();
  });

  it("renders the user's own records with RECORDS_PAGE=1, dated in the user's zone", async () => {
    vi.stubEnv("RECORDS_PAGE", "1");
    vi.useFakeTimers();
    // 03:30 UTC Nov 28 is still Nov 27 in New York.
    vi.setSystemTime(new Date("2026-11-28T03:30:00Z"));
    const html = renderToString(await RecordsPage());
    expect(m.getRecordSeries).toHaveBeenCalledWith(7);
    expect(m.getPRStats).toHaveBeenCalledWith(7);
    expect(html).toContain("104 ms");
    expect(html).toContain("As of Nov 27, 2026");
    expect(html).toContain("Set 7 days ago");
  });
});
