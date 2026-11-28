import { describe, expect, it } from "vitest";
import {
  ACUTE_MIN_DAYS,
  CHART_DAYS,
  CHRONIC_DAYS,
  HARD_DAY_STRAIN,
  LOAD_ZONES,
  REST_DAY_STRAIN,
  buildLoadSummary,
  classifyRatio,
  dayNumber,
  loadOn,
  shiftDay,
  type DailyStrain,
} from "./trainingLoad";

/** `n` consecutive days ending on `end`, strain from `f(i)` (i=0 is oldest). */
function days(end: string, n: number, f: (i: number) => number | null): DailyStrain[] {
  return Array.from({ length: n }, (_, i) => ({ date: shiftDay(end, i - (n - 1)), strain: f(i) }));
}

const TODAY = "2026-11-27";

describe("classifyRatio / zone constants", () => {
  it("uses the documented boundaries (0.8 and 1.3 are sweet spot, 1.5 is caution)", () => {
    expect(classifyRatio(0)).toBe("undertrained");
    expect(classifyRatio(0.79)).toBe("undertrained");
    expect(classifyRatio(0.8)).toBe("sweet-spot");
    expect(classifyRatio(1.3)).toBe("sweet-spot");
    expect(classifyRatio(1.31)).toBe("caution");
    expect(classifyRatio(1.5)).toBe("caution");
    expect(classifyRatio(1.51)).toBe("high");
    expect(classifyRatio(99)).toBe("high");
  });

  it("zone bands are contiguous", () => {
    for (let i = 1; i < LOAD_ZONES.length; i++) {
      expect(LOAD_ZONES[i].min).toBe(LOAD_ZONES[i - 1].max);
    }
  });
});

describe("date helpers", () => {
  it("rejects impossible dates", () => {
    expect(dayNumber("2026-02-30")).toBeNull();
    expect(dayNumber("2026-13-01")).toBeNull();
    expect(dayNumber("nope")).toBeNull();
    expect(dayNumber("2024-02-29")).not.toBeNull();
  });

  it("shifts across year and leap boundaries", () => {
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2024-03-01", -1)).toBe("2024-02-29");
  });
});

describe("buildLoadSummary", () => {
  it("empty history: no-data, no ratio, full chart of nulls", () => {
    const s = buildLoadSummary([], TODAY);
    expect(s.current.status).toBe("no-data");
    expect(s.current.ratio).toBeNull();
    expect(s.series).toHaveLength(CHART_DAYS);
    expect(s.series.every((p) => p.ratio === null)).toBe(true);
    expect(s.series.at(-1)!.date).toBe(TODAY);
    expect(s.series[0].date).toBe(shiftDay(TODAY, -(CHART_DAYS - 1)));
    expect(s.historyDays).toBe(0);
    expect(s.baselineDaysRemaining).toBe(CHRONIC_DAYS);
    expect(s.projection.date).toBe("2026-11-28");
    expect(s.projection.rest.status).toBe("building");
    expect(s.suggestion).toMatch(/No strain data/);
  });

  it("one day of data: building baseline with 27 days to go", () => {
    const s = buildLoadSummary([{ date: TODAY, strain: 10 }], TODAY);
    expect(s.current.status).toBe("building");
    expect(s.current.acute).toBe(10);
    expect(s.historyDays).toBe(1);
    expect(s.baselineDaysRemaining).toBe(27);
    expect(s.suggestion).toMatch(/27 more days/);
  });

  it("27 days is still building; 28 days produces a ratio", () => {
    const at27 = buildLoadSummary(days(TODAY, 27, () => 10), TODAY);
    expect(at27.current.status).toBe("building");
    expect(at27.suggestion).toMatch(/1 more day of/);
    const at28 = buildLoadSummary(days(TODAY, 28, () => 10), TODAY);
    expect(at28.current.status).toBe("ok");
    expect(at28.current.ratio).toBeCloseTo(1);
    expect(at28.current.zone).toBe("sweet-spot");
    expect(at28.baselineDaysRemaining).toBe(0);
  });

  it("computes the documented rolling means", () => {
    // 21 days at 8, then 7 days at 16: acute 16, chronic (21*8+7*16)/28 = 10.
    const rows = days(TODAY, 28, (i) => (i < 21 ? 8 : 16));
    const s = buildLoadSummary(rows, TODAY);
    expect(s.current.acute).toBe(16);
    expect(s.current.chronic).toBe(10);
    expect(s.current.ratio).toBeCloseTo(1.6);
    expect(s.current.zone).toBe("high");
    expect(s.suggestion).toMatch(/rest day brings you to/);
  });

  it("gaps and nulls are missing days, not zero-strain days", () => {
    // Every fourth day null and every seventh day absent — the mean ignores them.
    const rows = days(TODAY, 40, (i) => (i % 4 === 0 ? null : 10)).filter((_, i) => i % 7 !== 0);
    const s = buildLoadSummary(rows, TODAY);
    expect(s.current.status).toBe("ok");
    expect(s.current.acute).toBe(10);
    expect(s.current.chronic).toBe(10);
    expect(s.current.chronicDays).toBeLessThan(28);
  });

  it("ignores NaN, negative, invalid-date and future rows; keeps the larger duplicate", () => {
    const rows: DailyStrain[] = [
      ...days(TODAY, 28, () => 10),
      { date: TODAY, strain: 12 }, // duplicate — larger wins
      { date: shiftDay(TODAY, -1), strain: Number.NaN },
      { date: shiftDay(TODAY, -2), strain: -5 },
      { date: "2026-02-30", strain: 50 },
      { date: shiftDay(TODAY, 1), strain: 50 }, // future
    ];
    const s = buildLoadSummary(rows, TODAY);
    expect(s.current.acute).toBeCloseTo((6 * 10 + 12) / 7);
    expect(s.current.acuteDays).toBe(7);
  });

  it("sparse recent data yields no ratio instead of a misleading one", () => {
    // Long history, but only 3 of the last 7 days have data (the last 4 are missing).
    const rows = days(shiftDay(TODAY, -4), 60, () => 10);
    const s = buildLoadSummary(rows, TODAY);
    expect(s.current.acuteDays).toBeLessThan(ACUTE_MIN_DAYS);
    expect(s.current.status).toBe("sparse");
    expect(s.current.ratio).toBeNull();
  });

  it("zero chronic load never divides by zero", () => {
    const s = buildLoadSummary(days(TODAY, 40, () => 0), TODAY);
    expect(s.current.status).toBe("zero-baseline");
    expect(s.current.ratio).toBeNull();
    expect(s.series.every((p) => p.ratio === null || Number.isFinite(p.ratio))).toBe(true);
    expect(s.suggestion).toMatch(/baseline is zero/);
    // A hard day tomorrow makes chronic > 0 and the ratio finite.
    expect(s.projection.hard.status).toBe("ok");
    expect(Number.isFinite(s.projection.hard.ratio!)).toBe(true);
  });

  it("projects tomorrow for a rest day and a hard day", () => {
    const rows = days(TODAY, 40, () => 10);
    const s = buildLoadSummary(rows, TODAY);
    const { rest, hard, restStrain, hardStrain } = s.projection;
    expect(restStrain).toBe(REST_DAY_STRAIN);
    expect(hardStrain).toBe(HARD_DAY_STRAIN);
    // Acute: 6 days of 10 + tomorrow; chronic: 27 days of 10 + tomorrow.
    expect(rest.ratio).toBeCloseTo(((60 + 4) / 7) / ((270 + 4) / 28));
    expect(hard.ratio).toBeCloseTo(((60 + 16) / 7) / ((270 + 16) / 28));
    expect(rest.ratio!).toBeLessThan(1);
    expect(hard.ratio!).toBeGreaterThan(1);
    // Projection equals a real computation with that row appended.
    const real = loadOn([...rows, { date: "2026-11-28", strain: 16 }], "2026-11-28");
    expect(real.ratio).toBeCloseTo(hard.ratio!);
  });

  it("accepts custom rest/hard strains", () => {
    const s = buildLoadSummary(days(TODAY, 40, () => 10), TODAY, { restStrain: 0, hardStrain: 20 });
    expect(s.projection.restStrain).toBe(0);
    expect(s.projection.hard.ratio!).toBeGreaterThan(s.projection.rest.ratio!);
  });

  it("windows are exactly 7 and 28 calendar days across US and EU DST changes", () => {
    for (const today of ["2026-03-10", "2026-03-31", "2026-11-03", "2026-10-27"]) {
      // Value 1 inside the acute window, 100 on the day just outside it.
      const rows = days(today, 28, (i) => (i === 20 ? 100 : 1));
      const p = loadOn(rows, today);
      expect(p.acuteDays).toBe(7);
      expect(p.acute).toBe(1);
      expect(p.chronicDays).toBe(28);
    }
  });

  it("unsorted input gives the same result as sorted", () => {
    const rows = days(TODAY, 50, (i) => (i * 7) % 13);
    const shuffled = [...rows].reverse();
    expect(buildLoadSummary(shuffled, TODAY)).toEqual(buildLoadSummary(rows, TODAY));
  });

  it("throws on an invalid today", () => {
    expect(() => buildLoadSummary([], "2026-02-30")).toThrow(RangeError);
  });

  it("chooses a suggestion per zone", () => {
    const under = buildLoadSummary(days(TODAY, 40, (i) => (i < 33 ? 12 : 4)), TODAY);
    expect(under.current.zone).toBe("undertrained");
    expect(under.suggestion).toMatch(/below your baseline/);
    const caution = buildLoadSummary(days(TODAY, 40, (i) => (i < 33 ? 10 : 15)), TODAY);
    expect(caution.current.zone).toBe("caution");
    expect(caution.suggestion).toMatch(/rest day would bring you to/);
    const sweet = buildLoadSummary(days(TODAY, 40, () => 10), TODAY);
    expect(sweet.current.zone).toBe("sweet-spot");
    expect(sweet.suggestion).toMatch(/sweet spot/);
  });
});
