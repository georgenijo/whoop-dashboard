// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cyc, rec, slp } from "./__fixtures__/shareRows";

vi.mock("server-only", () => ({}));

const tzState = vi.hoisted(() => ({ tz: "America/New_York" }));
const m = vi.hoisted(() => ({
  getRecoveryRange: vi.fn<(...a: unknown[]) => unknown[]>(() => []),
  getSleepRange: vi.fn<(...a: unknown[]) => unknown[]>(() => []),
  getStrainRange: vi.fn<(...a: unknown[]) => unknown[]>(() => []),
  getWorkoutRowsRange: vi.fn<(...a: unknown[]) => unknown[]>(() => []),
  getInsightTimezone: vi.fn<(userId: number) => string>(() => tzState.tz),
}));

vi.mock("@/lib/db", () => ({
  getRecoveryRange: m.getRecoveryRange,
  getSleepRange: m.getSleepRange,
  getStrainRange: m.getStrainRange,
  getWorkoutRowsRange: m.getWorkoutRowsRange,
}));
vi.mock("@/lib/db/summary", () => ({ getInsightTimezone: m.getInsightTimezone }));

import { loadTodayCard } from "./load";

const OPTS = { hideNumbers: false, theme: "dark" as const };

beforeEach(() => {
  vi.clearAllMocks();
  tzState.tz = "America/New_York";
});

describe("loadTodayCard", () => {
  it("reads only the given user's rows, over today+yesterday and a 30-day baseline", () => {
    // 03:30Z Nov 28 = 22:30 Nov 27 in New York → today is Nov 27.
    loadTodayCard(7, OPTS, new Date("2026-11-28T03:30:00Z"));
    expect(m.getInsightTimezone).toHaveBeenCalledWith(7);
    expect(m.getRecoveryRange).toHaveBeenCalledWith(7, "2026-10-27", "2026-11-27");
    expect(m.getSleepRange).toHaveBeenCalledWith(7, "2026-11-26", "2026-11-27");
    expect(m.getStrainRange).toHaveBeenCalledWith(7, "2026-11-26", "2026-11-27");
    expect(m.getWorkoutRowsRange).toHaveBeenCalledWith(7, "2026-11-26", "2026-11-27");
  });

  it("the same instant is already Nov 28 for a UTC user", () => {
    tzState.tz = "UTC";
    const card = loadTodayCard(7, OPTS, new Date("2026-11-28T03:30:00Z"));
    expect(card.date).toBe("2026-11-28");
    expect(m.getSleepRange).toHaveBeenCalledWith(7, "2026-11-27", "2026-11-28");
  });

  it("windows across the DST fall-back night are whole calendar days", () => {
    // 2026-11-01 06:30Z = 01:30 EST, the hour after clocks fell back.
    loadTodayCard(3, OPTS, new Date("2026-11-01T06:30:00Z"));
    expect(m.getSleepRange).toHaveBeenCalledWith(3, "2026-10-31", "2026-11-01");
    expect(m.getRecoveryRange).toHaveBeenCalledWith(3, "2026-10-01", "2026-11-01");
  });

  it("builds the card from the reader rows and passes the options through", () => {
    m.getRecoveryRange.mockReturnValueOnce([rec("2026-11-27")]);
    m.getSleepRange.mockReturnValueOnce([slp("2026-11-27")]);
    m.getStrainRange.mockReturnValueOnce([cyc("2026-11-27")]);
    const card = loadTodayCard(7, { hideNumbers: true, theme: "light" }, new Date("2026-11-28T03:30:00Z"));
    expect(card).toMatchObject({ date: "2026-11-27", hideNumbers: true, theme: "light", hasAnyData: true });
    expect(card.tiles[0]).toMatchObject({ key: "recovery", value: null, band: "Green" });
  });
});
