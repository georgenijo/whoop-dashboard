import { describe, expect, it } from "vitest";
import { resolveRangeWindow, shiftDate } from "./range";

describe("resolveRangeWindow", () => {
  it("returns an exact inclusive seven-day calendar window", () => {
    expect(resolveRangeWindow("7d", "2026-08-30")).toEqual({
      days: 7,
      start: "2026-08-24",
      end: "2026-08-30",
      label: "7 days",
    });
  });

  it("uses the 30-day default for a missing or invalid range", () => {
    expect(resolveRangeWindow(undefined, "2026-08-30").start).toBe("2026-08-01");
    expect(resolveRangeWindow("bogus", "2026-08-30")).toEqual({
      days: 30,
      start: "2026-08-01",
      end: "2026-08-30",
      label: "30 days",
    });
  });

  it("keeps all-time unbounded", () => {
    expect(resolveRangeWindow("all", "2026-08-30")).toEqual({
      days: 9999,
      start: "0000-01-01",
      end: "2026-08-30",
      label: "all-time",
    });
  });
});

describe("shiftDate", () => {
  it("crosses month and leap-day boundaries", () => {
    expect(shiftDate("2024-03-01", -1)).toBe("2024-02-29");
  });
});
