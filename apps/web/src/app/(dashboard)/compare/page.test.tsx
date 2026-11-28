import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("server-only", () => ({}));

const { notFound, db, auth } = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  db: {
    getRecoveryRange: vi.fn((): unknown[] => []),
    getSleepRange: vi.fn((): unknown[] => []),
    getStrainRange: vi.fn((): unknown[] => []),
    getWorkoutRowsRange: vi.fn((): unknown[] => []),
  },
  auth: vi.fn(async () => ({ user: { id: 7 }, source: "web" })),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/lib/auth", () => ({ requireAuthOrSignin: auth }));
vi.mock("@/lib/db", () => db);
vi.mock("@/lib/date", () => ({ localToday: () => "2026-11-27" }));

import ComparePage from "./page";

describe("/compare page", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.unstubAllEnvs();
    cleanup();
  });

  it("404s with no auth or DB reads when PERIOD_COMPARE is unset", async () => {
    vi.stubEnv("PERIOD_COMPARE", "");
    await expect(ComparePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(auth).not.toHaveBeenCalled();
    for (const fn of Object.values(db)) expect(fn).not.toHaveBeenCalled();
  });

  it("404s for any value other than exactly 1", async () => {
    vi.stubEnv("PERIOD_COMPARE", "true");
    await expect(ComparePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders when enabled, reading both periods for the signed-in user only", async () => {
    vi.stubEnv("PERIOD_COMPARE", "1");
    db.getRecoveryRange.mockImplementation(() => [
      { date: "2026-11-20", recovery_score: 70, hrv: 60, rhr: 50, spo2: null, skin_temp: null },
    ]);
    const el = await ComparePage({
      searchParams: Promise.resolve({
        a_from: "2026-11-01",
        a_to: "2026-11-27",
        b_from: ["2026-10-01", "ignored"],
        b_to: "2026-10-27",
      }),
    });
    const { container } = render(el);
    expect(container.querySelector("h1")?.textContent).toBe("Compare periods");
    expect(db.getRecoveryRange).toHaveBeenCalledWith(7, "2026-11-01", "2026-11-27");
    expect(db.getRecoveryRange).toHaveBeenCalledWith(7, "2026-10-01", "2026-10-27");
    for (const fn of Object.values(db)) {
      expect(fn).toHaveBeenCalledTimes(2);
      for (const call of fn.mock.calls as unknown as unknown[][]) expect(call[0]).toBe(7);
    }
    expect(container.querySelectorAll("li[data-metric]")).toHaveLength(9);
  });
});
