import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 7 }, source: "web" })),
  getRecoveryRange: vi.fn(() => [] as unknown[]),
  getSleepRange: vi.fn(() => [] as unknown[]),
  getStrainRange: vi.fn(() => [] as unknown[]),
  getWorkoutRowsRange: vi.fn(() => [] as unknown[]),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth", () => ({ requireAuthOrSignin: mocks.requireAuthOrSignin }));
vi.mock("@/lib/date", () => ({ localToday: () => "2026-11-27" }));
vi.mock("@/lib/db", () => ({
  getRecoveryRange: mocks.getRecoveryRange,
  getSleepRange: mocks.getSleepRange,
  getStrainRange: mocks.getStrainRange,
  getWorkoutRowsRange: mocks.getWorkoutRowsRange,
}));

import ReportPage from "./page";

const READERS = [
  mocks.getRecoveryRange,
  mocks.getSleepRange,
  mocks.getStrainRange,
  mocks.getWorkoutRowsRange,
];

const params = (days?: string | string[]) => ({ searchParams: Promise.resolve(days === undefined ? {} : { days }) });

describe("/report page", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it.each([undefined, "", "0", "true", "yes", " 1"])(
    "404s with HEALTH_REPORT=%j before auth and reads nothing",
    async (v) => {
      vi.stubEnv("HEALTH_REPORT", v as string);
      await expect(ReportPage(params("30"))).rejects.toThrow("NEXT_NOT_FOUND");
      expect(mocks.requireAuthOrSignin).not.toHaveBeenCalled();
      for (const r of READERS) expect(r).not.toHaveBeenCalled();
    },
  );

  it.each([
    [undefined, "2026-10-29", 30],
    ["7", "2026-11-21", 7],
    ["30", "2026-10-29", 30],
    ["90", "2026-08-30", 90],
    ["365", "2026-10-29", 30],
    ["-1", "2026-10-29", 30],
    [["7", "90"], "2026-10-29", 30],
  ] as const)("?days=%j reads the user's own window starting %s", async (days, start, n) => {
    vi.stubEnv("HEALTH_REPORT", "1");
    render(await ReportPage(params(days as string | string[] | undefined)));
    for (const r of READERS) expect(r).toHaveBeenCalledWith(7, start, "2026-11-27");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(`last ${n} days`);
  });

  it("renders the summary for the authed user's rows", async () => {
    vi.stubEnv("HEALTH_REPORT", "1");
    mocks.getRecoveryRange.mockReturnValue([
      { date: "2026-11-26", recovery_score: 40, hrv: 50, rhr: 55, spo2: null, skin_temp: null },
      { date: "2026-11-27", recovery_score: 80, hrv: 70, rhr: 51, spo2: null, skin_temp: null },
    ]);
    render(await ReportPage(params("7")));
    expect(screen.getByTestId("hr-coverage")).toHaveTextContent("2/7 days scored recovery");
    expect(screen.getByTestId("hr-metric-recovery")).toHaveTextContent("60%");
    expect(screen.getByTestId("hr-notable")).toHaveTextContent("80% · Fri, Nov 27");
  });
});
