// @vitest-environment node
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const m = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 7 }, source: "web" })),
  getUserSettings: vi.fn(),
  getRecoveryRange: vi.fn(),
  getSleepRangeRaw: vi.fn(),
  getNaps: vi.fn(),
  getStrainRange: vi.fn(),
  getWorkoutRowsRange: vi.fn(),
  getSyncLogs: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound: m.notFound }));
vi.mock("@/lib/auth", () => ({ requireAuthOrSignin: m.requireAuthOrSignin }));
vi.mock("@/lib/db", () => ({
  getUserSettings: m.getUserSettings,
  getRecoveryRange: m.getRecoveryRange,
  getSleepRangeRaw: m.getSleepRangeRaw,
  getNaps: m.getNaps,
  getStrainRange: m.getStrainRange,
  getWorkoutRowsRange: m.getWorkoutRowsRange,
  getSyncLogs: m.getSyncLogs,
}));

import DataHealthPage from "./page";

const render = async (p: Promise<React.ReactElement>) => renderToString(await p).replace(/<!-- -->/g, "");

const READERS = [
  "getUserSettings",
  "getRecoveryRange",
  "getSleepRangeRaw",
  "getNaps",
  "getStrainRange",
  "getWorkoutRowsRange",
  "getSyncLogs",
] as const;

const params = (window?: string) => ({ searchParams: Promise.resolve(window ? { window } : {}) });

beforeEach(() => {
  vi.clearAllMocks();
  for (const r of READERS) m[r].mockReturnValue([]);
  m.getUserSettings.mockReturnValue({ tz: "America/New_York" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("/data-health page", () => {
  it.each([undefined, "", "0", "true", "yes"])(
    "404s with DATA_HEALTH=%s before auth or any DB read",
    async (v) => {
      vi.stubEnv("DATA_HEALTH", v as string);
      await expect(DataHealthPage(params())).rejects.toThrow("NEXT_NOT_FOUND");
      expect(m.requireAuthOrSignin).not.toHaveBeenCalled();
      for (const r of READERS) expect(m[r]).not.toHaveBeenCalled();
    },
  );

  it("with DATA_HEALTH=1 reads only the signed-in user's rows, dated in their zone", async () => {
    vi.stubEnv("DATA_HEALTH", "1");
    vi.useFakeTimers();
    // 03:30 UTC Nov 28 is still Nov 27 in New York.
    vi.setSystemTime(new Date("2026-11-28T03:30:00Z"));
    m.getRecoveryRange.mockReturnValue([
      { date: "2026-11-26", recovery_score: 70, hrv: 60, rhr: 50, spo2: null, skin_temp: null },
    ]);
    m.getSyncLogs.mockReturnValue([
      { started_at: "2026-11-27T13:14:00Z", status: "ok", source: "manual", error_message: null },
    ]);
    const html = await render(DataHealthPage(params()));
    // 120-day fetch ending today in the user's zone.
    for (const r of ["getRecoveryRange", "getSleepRangeRaw", "getNaps", "getStrainRange", "getWorkoutRowsRange"] as const) {
      expect(m[r]).toHaveBeenCalledWith(7, "2026-07-31", "2026-11-27");
    }
    expect(m.getSyncLogs).toHaveBeenCalledWith(7);
    expect(m.getUserSettings).toHaveBeenCalledWith(7);
    expect(html).toContain("Data health");
    expect(html).toContain("last 30 days (Oct 29–Nov 27)");
    expect(html).toContain("Manual sync");
    expect(html).toContain("Nov 27, 8:14 AM"); // 13:14Z in New York
  });

  it("honours ?window=90 and falls back to 30 for junk", async () => {
    vi.stubEnv("DATA_HEALTH", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T15:00:00Z"));
    m.getRecoveryRange.mockReturnValue([
      { date: "2026-11-26", recovery_score: 70, hrv: 60, rhr: 50, spo2: null, skin_temp: null },
    ]);
    expect(await render(DataHealthPage(params("90")))).toContain("last 90 days (Aug 30–Nov 27)");
    expect(await render(DataHealthPage(params("7")))).toContain("last 30 days");
  });

  it("crosses the US DST change (spring forward) on the user's calendar", async () => {
    vi.stubEnv("DATA_HEALTH", "1");
    vi.useFakeTimers();
    // 03:30 UTC Mar 9 is 23:30 EDT Mar 8.
    vi.setSystemTime(new Date("2026-03-09T03:30:00Z"));
    await DataHealthPage(params());
    expect(m.getRecoveryRange).toHaveBeenCalledWith(7, "2025-11-09", "2026-03-08");
  });

  it("falls back to UTC for a missing or invalid timezone", async () => {
    vi.stubEnv("DATA_HEALTH", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-28T03:30:00Z"));
    m.getUserSettings.mockReturnValue({ tz: "Not/AZone" });
    await DataHealthPage(params());
    expect(m.getRecoveryRange).toHaveBeenLastCalledWith(7, "2026-08-01", "2026-11-28");
    m.getUserSettings.mockReturnValue(null);
    await DataHealthPage(params());
    expect(m.getRecoveryRange).toHaveBeenLastCalledWith(7, "2026-08-01", "2026-11-28");
  });

  it("lists requirements only for features whose flags are on", async () => {
    vi.stubEnv("DATA_HEALTH", "1");
    vi.stubEnv("TRAINING_LOAD", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T15:00:00Z"));
    const html = await render(DataHealthPage(params()));
    expect(html).toContain("Training Load ratio");
    expect(html).not.toContain("Recovery drivers");
    expect(html).not.toContain("Weekly review");
  });
});
