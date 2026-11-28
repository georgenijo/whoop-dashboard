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

import WeeklyPage from "./page";

const READERS = [
  mocks.getRecoveryRange,
  mocks.getSleepRange,
  mocks.getStrainRange,
  mocks.getWorkoutRowsRange,
];

describe("/weekly page gate", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it.each([undefined, "", "0", "true", "yes"])("404s with WEEKLY_REVIEW=%s and reads nothing", async (v) => {
    if (v === undefined) vi.stubEnv("WEEKLY_REVIEW", undefined as unknown as string);
    else vi.stubEnv("WEEKLY_REVIEW", v);
    await expect(WeeklyPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.requireAuthOrSignin).not.toHaveBeenCalled();
    for (const r of READERS) expect(r).not.toHaveBeenCalled();
  });

  it("with WEEKLY_REVIEW=1 reads both weeks through the user-scoped readers and renders", async () => {
    vi.stubEnv("WEEKLY_REVIEW", "1");
    mocks.getRecoveryRange.mockReturnValue([
      { date: "2026-11-27", recovery_score: 74, hrv: 61, rhr: 50, spo2: null, skin_temp: null },
    ]);
    const el = await WeeklyPage();
    render(el);
    for (const r of READERS) expect(r).toHaveBeenCalledWith(7, "2026-11-14", "2026-11-27");
    expect(screen.getByTestId("weekly-review")).toBeInTheDocument();
    expect(screen.getByTestId("weekly-not-comparable")).toBeInTheDocument();
    expect(screen.getByText("Best recovery was 74% on Fri, Nov 27")).toBeInTheDocument();
  });
});
