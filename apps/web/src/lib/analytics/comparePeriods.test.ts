import { describe, expect, it } from "vitest";
import {
  MAX_PERIOD_DAYS,
  METRICS,
  addDays,
  comparePeriods,
  daysInclusive,
  enumerateDates,
  formatChange,
  isIsoDate,
  judgeChange,
  presetPeriods,
  resolveComparison,
  sparklinePaths,
  type PeriodData,
} from "./comparePeriods";

const EMPTY: PeriodData = { recovery: [], sleep: [], cycles: [], workouts: [] };
const byKey = (rows: ReturnType<typeof comparePeriods>, key: string) =>
  rows.find((r) => r.def.key === key)!;

const p = (from: string, to: string) => ({ from, to, days: daysInclusive(from, to) });

describe("date helpers", () => {
  it("validates real calendar dates only", () => {
    expect(isIsoDate("2026-11-27")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-1-01")).toBe(false);
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
    expect(isIsoDate("2026-11-27T00:00")).toBe(false);
  });

  it("counts inclusive days across DST transitions without drift", () => {
    // US spring-forward and fall-back weekends, and EU ones.
    expect(daysInclusive("2026-03-07", "2026-03-09")).toBe(3);
    expect(daysInclusive("2026-10-31", "2026-11-02")).toBe(3);
    expect(enumerateDates("2026-03-28", "2026-03-30")).toEqual([
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
    ]);
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(daysInclusive("2026-11-27", "2026-11-27")).toBe(1);
  });

  it("is independent of the runtime timezone", () => {
    const original = process.env.TZ;
    try {
      for (const tz of ["America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
        process.env.TZ = tz;
        expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
        expect(enumerateDates("2026-12-31", "2027-01-01")).toEqual(["2026-12-31", "2027-01-01"]);
      }
    } finally {
      process.env.TZ = original;
    }
  });
});

describe("presets", () => {
  it("month: month-to-date vs the whole previous month, across a year boundary", () => {
    expect(presetPeriods("month", "2026-11-27")).toEqual({
      a: p("2026-11-01", "2026-11-27"),
      b: p("2026-10-01", "2026-10-31"),
    });
    expect(presetPeriods("month", "2027-01-03").b).toEqual(p("2026-12-01", "2026-12-31"));
    expect(presetPeriods("month", "2028-03-15").b).toEqual(p("2028-02-01", "2028-02-29"));
  });

  it("30d: two adjacent, non-overlapping 30-day windows", () => {
    const { a, b } = presetPeriods("30d", "2026-11-27");
    expect(a).toEqual(p("2026-10-29", "2026-11-27"));
    expect(b).toEqual(p("2026-09-29", "2026-10-28"));
    expect(a.days).toBe(30);
    expect(b.days).toBe(30);
  });

  it("year: year-to-date vs the same dates last year, Feb 29 clamped", () => {
    expect(presetPeriods("year", "2026-11-27")).toEqual({
      a: p("2026-01-01", "2026-11-27"),
      b: p("2025-01-01", "2025-11-27"),
    });
    expect(presetPeriods("year", "2028-02-29").b).toEqual(p("2027-01-01", "2027-02-28"));
    expect(presetPeriods("year", "2026-01-01").a.days).toBe(1);
  });
});

describe("resolveComparison", () => {
  const today = "2026-11-27";

  it("defaults to last 30 days vs the 30 before", () => {
    const r = resolveComparison({}, today);
    expect(r.preset).toBe("30d");
    expect(r.errors).toEqual([]);
    expect(r.notes).toEqual([]);
  });

  it("honours a known preset and ignores an unknown one", () => {
    expect(resolveComparison({ preset: "month" }, today).preset).toBe("month");
    expect(resolveComparison({ preset: "decade" }, today).preset).toBe("30d");
  });

  it("notes differing lengths for the month preset", () => {
    const r = resolveComparison({ preset: "month" }, today);
    expect(r.notes.join(" ")).toMatch(/27 vs 31 days/);
  });

  it("accepts a valid custom range", () => {
    const r = resolveComparison(
      { a_from: "2026-11-01", a_to: "2026-11-07", b_from: "2026-10-01", b_to: "2026-10-07" },
      today,
    );
    expect(r.preset).toBeNull();
    expect(r.a).toEqual(p("2026-11-01", "2026-11-07"));
    expect(r.b).toEqual(p("2026-10-01", "2026-10-07"));
    expect(r.errors).toEqual([]);
    expect(r.notes).toEqual([]);
  });

  it("swaps reversed ends, clamps future ends and over-long spans", () => {
    const r = resolveComparison(
      { a_from: "2026-11-10", a_to: "2026-11-01", b_from: "2024-01-01", b_to: "2026-12-25" },
      today,
    );
    expect(r.a).toEqual(p("2026-11-01", "2026-11-10"));
    expect(r.b.to).toBe(today);
    expect(r.b.days).toBe(MAX_PERIOD_DAYS);
    expect(r.b.from).toBe(addDays(today, -(MAX_PERIOD_DAYS - 1)));
    const notes = r.notes.join("\n");
    expect(notes).toMatch(/swapped/);
    expect(notes).toMatch(/moved back to today/);
    expect(notes).toMatch(/shortened to the last 400 days/);
    expect(notes).toMatch(/overlap/);
  });

  it("falls back to the preset with errors for invalid or wholly future ranges", () => {
    const bad = resolveComparison(
      { preset: "year", a_from: "2026-02-30", a_to: "2026-03-01", b_from: "2027-01-01", b_to: "2027-01-05" },
      today,
    );
    expect(bad.preset).toBe("year");
    expect(bad.errors).toHaveLength(2);
    expect(bad.errors[0]).toMatch(/Period A/);
    expect(bad.errors[1]).toMatch(/future/);
  });

  it("treats a partially filled custom form as an error", () => {
    const r = resolveComparison({ a_from: "2026-11-01" }, today);
    expect(r.preset).toBe("30d");
    expect(r.errors.length).toBe(2);
  });

  it("drops clamp notes from a discarded custom range", () => {
    const r = resolveComparison(
      { a_from: "2026-11-10", a_to: "2026-11-01", b_from: "nope", b_to: "2026-10-01" },
      today,
    );
    expect(r.notes.join(" ")).not.toMatch(/swapped/);
  });
});

describe("judgeChange", () => {
  it("respects good direction and the noise threshold", () => {
    const rhr = METRICS.find((m) => m.key === "rhr")!;
    expect(judgeChange(rhr, -2)).toEqual({ direction: "down", verdict: "better" });
    expect(judgeChange(rhr, 2)).toEqual({ direction: "up", verdict: "worse" });
    expect(judgeChange(rhr, 0.5)).toEqual({ direction: "flat", verdict: "same" });
    expect(judgeChange(rhr, -1)).toEqual({ direction: "down", verdict: "better" });
    expect(judgeChange(rhr, null)).toEqual({ direction: null, verdict: "no-data" });
    const strain = METRICS.find((m) => m.key === "strain")!;
    expect(judgeChange(strain, 3)).toEqual({ direction: "up", verdict: "changed" });
  });
});

describe("comparePeriods", () => {
  const A = p("2026-11-01", "2026-11-07");
  const B = p("2026-10-01", "2026-10-07");

  it("returns no-data for every metric when both periods are empty", () => {
    const rows = comparePeriods(A, B, EMPTY, EMPTY);
    expect(rows).toHaveLength(METRICS.length);
    for (const r of rows) {
      expect(r.verdict).toBe("no-data");
      expect(r.change).toBeNull();
      expect(r.a.series).toHaveLength(7);
    }
  });

  it("averages over scored days, skipping gaps and nulls", () => {
    const dataA: PeriodData = {
      ...EMPTY,
      recovery: [
        { date: "2026-11-01", recovery_score: 80, hrv: 60, rhr: 50 },
        { date: "2026-11-03", recovery_score: null, hrv: 70, rhr: null },
        { date: "2026-11-05", recovery_score: 60, hrv: null, rhr: 52 },
        // Out-of-period row is ignored.
        { date: "2026-12-01", recovery_score: 0, hrv: 0, rhr: 0 },
      ],
    };
    const dataB: PeriodData = {
      ...EMPTY,
      recovery: [{ date: "2026-10-02", recovery_score: 50, hrv: 64, rhr: 55 }],
    };
    const rows = comparePeriods(A, B, dataA, dataB);
    const rec = byKey(rows, "recovery");
    expect(rec.a.value).toBe(70);
    expect(rec.a.scoredDays).toBe(2);
    expect(rec.a.series).toEqual([80, null, null, null, 60, null, null]);
    expect(rec.change).toBe(20);
    expect(rec.changePct).toBeCloseTo(40);
    expect(rec.verdict).toBe("better");
    const hrv = byKey(rows, "hrv");
    expect(hrv.a.value).toBe(65);
    expect(hrv.verdict).toBe("same"); // −1 ms is inside the 3 ms band
    const rhr = byKey(rows, "rhr");
    expect(rhr.change).toBe(-4);
    expect(rhr.verdict).toBe("better");
  });

  it("handles a one-day period on each side", () => {
    const one = p("2026-11-27", "2026-11-27");
    const prev = p("2026-11-26", "2026-11-26");
    const rows = comparePeriods(
      one,
      prev,
      { ...EMPTY, cycles: [{ date: "2026-11-27", strain: 14.2 }] },
      { ...EMPTY, cycles: [{ date: "2026-11-26", strain: 10 }] },
    );
    const strain = byKey(rows, "strain");
    expect(strain.change).toBeCloseTo(4.2);
    expect(strain.verdict).toBe("changed");
    expect(strain.a.series).toEqual([14.2]);
  });

  it("computes sleep hours from stages and requires all three", () => {
    const h = 3_600_000;
    const rows = comparePeriods(
      A,
      B,
      {
        ...EMPTY,
        sleep: [
          { date: "2026-11-01", light_ms: 4 * h, deep_ms: 1.5 * h, rem_ms: 2 * h, performance: 90, consistency: 80 },
          { date: "2026-11-02", light_ms: 4 * h, deep_ms: null, rem_ms: 2 * h, performance: 70, consistency: null },
        ],
      },
      {
        ...EMPTY,
        sleep: [{ date: "2026-10-01", light_ms: 3 * h, deep_ms: 1 * h, rem_ms: 1.5 * h, performance: 80, consistency: 82 }],
      },
    );
    const hours = byKey(rows, "sleep_hours");
    expect(hours.a.value).toBe(7.5);
    expect(hours.a.scoredDays).toBe(1);
    expect(hours.change).toBe(2);
    expect(hours.verdict).toBe("better");
    expect(byKey(rows, "sleep_performance").a.value).toBe(80);
    expect(byKey(rows, "sleep_consistency").verdict).toBe("same");
  });

  it("rates workouts per week, fair across different period lengths", () => {
    const fourteen = p("2026-11-01", "2026-11-14");
    const rows = comparePeriods(
      fourteen,
      B,
      {
        ...EMPTY,
        cycles: [{ date: "2026-11-01", strain: 10 }],
        workouts: [
          { date: "2026-11-01", duration_sec: 3600 },
          { date: "2026-11-01", duration_sec: 1800 },
          { date: "2026-11-09", duration_sec: null },
          { date: "2026-11-12", duration_sec: 2400 },
        ],
      },
      { ...EMPTY, cycles: [{ date: "2026-10-03", strain: 9 }], workouts: [{ date: "2026-10-03", duration_sec: 3000 }] },
    );
    const count = byKey(rows, "workouts_per_week");
    expect(count.a.value).toBe(2); // 4 workouts over 2 weeks
    expect(count.b.value).toBe(1);
    expect(count.verdict).toBe("better");
    const mins = byKey(rows, "workout_minutes_per_week");
    expect(mins.a.value).toBe(65); // 130 min / 2 weeks; null duration adds 0
    expect(mins.b.value).toBe(50);
    expect(mins.change).toBe(15);
    expect(mins.verdict).toBe("better"); // exactly at threshold counts as a change
  });

  it("reports zero workouts as 0/wk when the strap had data, no-data otherwise", () => {
    const rows = comparePeriods(
      A,
      B,
      { ...EMPTY, recovery: [{ date: "2026-11-02", recovery_score: 70, hrv: 60, rhr: 50 }] },
      EMPTY,
    );
    const count = byKey(rows, "workouts_per_week");
    expect(count.a.value).toBe(0);
    expect(count.b.value).toBeNull();
    expect(count.verdict).toBe("no-data");
  });

  it("ignores non-finite values and keeps the first duplicate date", () => {
    const rows = comparePeriods(
      A,
      B,
      {
        ...EMPTY,
        recovery: [
          { date: "2026-11-01", recovery_score: Number.NaN, hrv: 60, rhr: 50 },
          { date: "2026-11-02", recovery_score: 70, hrv: 60, rhr: 50 },
          { date: "2026-11-02", recovery_score: 10, hrv: 60, rhr: 50 },
        ],
      },
      { ...EMPTY, recovery: [{ date: "2026-10-01", recovery_score: 0, hrv: 60, rhr: 50 }] },
    );
    const rec = byKey(rows, "recovery");
    expect(rec.a.value).toBe(70);
    expect(rec.changePct).toBeNull(); // baseline 0
  });
});

describe("sparklinePaths", () => {
  it("is empty without data and breaks lines at gaps", () => {
    expect(sparklinePaths([null], [], 100, 20)).toEqual({ a: "", b: "" });
    const { a, b } = sparklinePaths([1, 2, null, 4], [3], 100, 20);
    expect(a.match(/M/g)).toHaveLength(2);
    expect(a).toContain("L");
    expect(b.startsWith("M50.0")).toBe(true); // single point centred
  });

  it("uses a shared y-scale for both series", () => {
    const { a, b } = sparklinePaths([0, 0], [10, 10], 100, 20, 0);
    expect(a).toBe("M0.0 20.0 L100.0 20.0");
    expect(b).toBe("M0.0 0.0 L100.0 0.0");
  });
});

describe("formatChange", () => {
  const rec = METRICS.find((m) => m.key === "recovery")!;
  it("signs and rounds", () => {
    expect(formatChange(rec, 4.6)).toBe("+5");
    expect(formatChange(rec, -4.6)).toBe("−5");
    expect(formatChange(rec, 0.2)).toBe("±0");
    expect(formatChange(rec, null)).toBe("—");
  });
});

