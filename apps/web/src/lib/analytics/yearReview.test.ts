import { describe, expect, it } from "vitest";
import type { RecoveryRow } from "@/lib/db/recovery";
import type { SleepRow } from "@/lib/db/sleep";
import type { CycleRow } from "@/lib/db/strain";
import type { WorkoutRow } from "@/lib/db/workouts";
import {
  asleepHours,
  buildYearReview,
  dayNumber,
  isLeapYear,
  longestGreenStreak,
  parseReviewYear,
  shortDate,
  yearBounds,
} from "./yearReview";

const rec = (date: string, score: number | null, hrv: number | null = 50, rhr: number | null = 55): RecoveryRow => ({
  date,
  recovery_score: score,
  hrv,
  rhr,
  spo2: null,
  skin_temp: null,
});

const slp = (date: string, hours: number | null, consistency: number | null = null): SleepRow => ({
  date,
  in_bed_ms: hours == null ? null : hours * 3_600_000 + 1_800_000,
  light_ms: hours == null ? null : hours * 0.5 * 3_600_000,
  deep_ms: hours == null ? null : hours * 0.25 * 3_600_000,
  rem_ms: hours == null ? null : hours * 0.25 * 3_600_000,
  awake_ms: 1_800_000,
  sleep_need_ms: null,
  performance: null,
  efficiency: null,
  consistency,
  disturbances: null,
  cycles: null,
  respiratory_rate: null,
  need_from_baseline_ms: null,
  need_from_debt_ms: null,
  need_from_strain_ms: null,
  need_from_nap_ms: null,
  start_local: null,
  end_local: null,
});

const cyc = (date: string, strain: number | null): CycleRow => ({
  date,
  strain,
  kilojoule: null,
  avg_hr: null,
  max_hr: null,
});

let wid = 0;
const wo = (date: string, sport: string | null, minutes: number, zone2Min = 0): WorkoutRow => ({
  id: String(++wid),
  date,
  sport,
  duration_sec: minutes * 60,
  avg_hr: null,
  max_hr: null,
  strain: null,
  kilojoule: null,
  distance_m: null,
  zone_0_ms: 999_999,
  zone_1_ms: null,
  zone_2_ms: zone2Min * 60_000,
  zone_3_ms: null,
  zone_4_ms: null,
  zone_5_ms: null,
  start_utc: null,
  end_utc: null,
});

const empty = { recovery: [], sleep: [], cycles: [], workouts: [] };

describe("date helpers", () => {
  it("dayNumber rejects malformed and impossible dates", () => {
    expect(dayNumber("2025-02-30")).toBeNull();
    expect(dayNumber("2025-2-3")).toBeNull();
    expect(dayNumber("")).toBeNull();
    expect(dayNumber("2024-02-29")).not.toBeNull();
    expect(dayNumber("2025-02-29")).toBeNull();
  });

  it("dayNumber steps by exactly one across DST transitions", () => {
    // US spring-forward (Mar 9 2025) and fall-back (Nov 2 2025).
    expect(dayNumber("2025-03-10")! - dayNumber("2025-03-09")!).toBe(1);
    expect(dayNumber("2025-11-03")! - dayNumber("2025-11-02")!).toBe(1);
    expect(dayNumber("2026-01-01")! - dayNumber("2025-12-31")!).toBe(1);
  });

  it("isLeapYear follows the Gregorian rule", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
  });

  it("shortDate formats without local-time parsing", () => {
    expect(shortDate("2025-01-01")).toBe("Jan 1");
    expect(shortDate("2025-12-31")).toBe("Dec 31");
    expect(shortDate("junk")).toBe("junk");
  });
});

describe("parseReviewYear", () => {
  it("defaults to the current year", () => {
    expect(parseReviewYear(undefined, 2026)).toBe(2026);
  });
  it("accepts a valid past year", () => {
    expect(parseReviewYear("2024", 2026)).toBe(2024);
    expect(parseReviewYear(["2025", "2019"], 2026)).toBe(2025);
  });
  it.each(["2027", "1999", "2011", "20x5", "24", "2025.0", " 2025", "-2025", "02025", ""])(
    "rejects %j",
    (raw) => {
      expect(parseReviewYear(raw, 2026)).toBe(2026);
    },
  );
});

describe("yearBounds", () => {
  it("clamps the current year to today", () => {
    expect(yearBounds(2026, "2026-11-27")).toEqual({ start: "2026-01-01", end: "2026-11-27" });
  });
  it("uses the full calendar year for past years", () => {
    expect(yearBounds(2024, "2026-11-27")).toEqual({ start: "2024-01-01", end: "2024-12-31" });
  });
  it("covers Dec 31 itself", () => {
    expect(yearBounds(2026, "2026-12-31")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });
});

describe("asleepHours", () => {
  it("sums stages", () => {
    expect(asleepHours(slp("2025-01-01", 7))).toBeCloseTo(7);
  });
  it("falls back to in-bed minus awake when stages are missing", () => {
    const row = { ...slp("2025-01-01", null), in_bed_ms: 8 * 3_600_000, awake_ms: 3_600_000 };
    expect(asleepHours(row)).toBeCloseTo(7);
  });
  it("returns null with no usable data", () => {
    expect(asleepHours(slp("2025-01-01", null))).toBeNull();
  });
});

describe("longestGreenStreak", () => {
  it("returns null with no green days", () => {
    expect(longestGreenStreak([rec("2025-01-01", 40)])).toBeNull();
  });
  it("counts a single green day", () => {
    expect(longestGreenStreak([rec("2025-01-01", 80)])).toEqual({
      days: 1,
      start: "2025-01-01",
      end: "2025-01-01",
    });
  });
  it("breaks on a missing day and on a non-green day", () => {
    const rows = [
      rec("2025-01-01", 70),
      rec("2025-01-02", 70),
      // 01-03 missing
      rec("2025-01-04", 70),
      rec("2025-01-05", 70),
      rec("2025-01-06", 70),
      rec("2025-01-07", 66), // yellow
      rec("2025-01-08", 90),
    ];
    expect(longestGreenStreak(rows)).toEqual({ days: 3, start: "2025-01-04", end: "2025-01-06" });
  });
  it("crosses month ends, leap days and DST without gaps", () => {
    const rows = ["2024-02-28", "2024-02-29", "2024-03-01", "2024-03-09", "2024-03-10", "2024-03-11"].map(
      (d) => rec(d, 75),
    );
    expect(longestGreenStreak(rows)?.days).toBe(3);
    expect(longestGreenStreak(rows)?.start).toBe("2024-02-28");
  });
  it("is order- and duplicate-insensitive; first longest run wins ties", () => {
    const rows = [rec("2025-05-02", 80), rec("2025-05-01", 80), rec("2025-05-01", 80), rec("2025-06-01", 80), rec("2025-06-02", 80)];
    expect(longestGreenStreak(rows)).toEqual({ days: 2, start: "2025-05-01", end: "2025-05-02" });
  });
  it("ignores null scores", () => {
    expect(longestGreenStreak([rec("2025-01-01", null)])).toBeNull();
  });
});

describe("buildYearReview", () => {
  it("empty year -> no data, no highlights, months through end", () => {
    const r = buildYearReview(2024, "2026-11-27", empty);
    expect(r.hasData).toBe(false);
    expect(r.highlights).toEqual([]);
    expect(r.months).toHaveLength(12);
    expect(r.daysInYear).toBe(366);
    expect(r.daysElapsed).toBe(366);
    expect(r.bestMonth).toBeNull();
    expect(r.worstMonth).toBeNull();
    expect(r.averages.recovery).toBeNull();
    expect(r.workouts).toEqual({ count: 0, minutes: 0, zoneMinutes: [0, 0, 0, 0, 0], topSports: [] });
  });

  it("partial current year: months stop at today's month, last one flagged partial", () => {
    const r = buildYearReview(2026, "2026-03-15", { ...empty, recovery: [rec("2026-03-15", 70)] });
    expect(r.isCurrentYear).toBe(true);
    expect(r.months.map((m) => m.month)).toEqual([1, 2, 3]);
    expect(r.months[2].partial).toBe(true);
    expect(r.months[0].partial).toBe(false);
    expect(r.daysElapsed).toBe(31 + 28 + 15);
  });

  it("a single scored day still produces a coherent review", () => {
    const r = buildYearReview(2025, "2026-11-27", {
      recovery: [rec("2025-07-04", 81, 62, 51)],
      sleep: [slp("2025-07-04", 7.5, 80)],
      cycles: [cyc("2025-07-04", 12.3)],
      workouts: [],
    });
    expect(r.hasData).toBe(true);
    expect(r.daysScored).toBe(1);
    expect(r.averages.recovery).toBe(81);
    // One day isn't enough to rank months.
    expect(r.bestMonth).toBeNull();
    expect(r.greenStreak).toEqual({ days: 1, start: "2025-07-04", end: "2025-07-04" });
    expect(r.personalBests.highestHrv).toEqual({ value: 62, date: "2025-07-04" });
    expect(r.personalBests.lowestRhr).toEqual({ value: 51, date: "2025-07-04" });
    expect(r.personalBests.longestSleepHours?.value).toBeCloseTo(7.5);
    expect(r.highestStrainDay).toEqual({ value: 12.3, date: "2025-07-04" });
    expect(r.highlights[0]).toBe("You were scored on 1 day — under 1% of 2025.");
    expect(r.highlights.length).toBeGreaterThanOrEqual(3);
  });

  it("drops rows outside the year and invalid dates (defensive bounding)", () => {
    const r = buildYearReview(2025, "2026-11-27", {
      recovery: [rec("2024-12-31", 90), rec("2025-01-01", 50), rec("2025-12-31", 60), rec("2026-01-01", 90), rec("2025-02-30", 99)],
      sleep: [],
      cycles: [cyc("2026-01-01", 20), cyc("2025-06-01", 10)],
      workouts: [wo("2024-12-31", "Running", 30), wo("2025-03-01", "Running", 30)],
    });
    expect(r.daysScored).toBe(2);
    expect(r.averages.recovery).toBe(55);
    expect(r.highestStrainDay?.date).toBe("2025-06-01");
    expect(r.workouts.count).toBe(1);
  });

  it("averages skip nulls per metric instead of counting them as zero", () => {
    const r = buildYearReview(2025, "2026-11-27", {
      ...empty,
      recovery: [rec("2025-01-01", 60, null, 50), rec("2025-01-02", null, 80, null)],
    });
    expect(r.daysScored).toBe(1);
    expect(r.averages.recovery).toBe(60);
    expect(r.averages.hrv).toBe(80);
    expect(r.averages.rhr).toBe(50);
  });

  it("ranks best/worst months only with enough scored days; ties go to the earlier month", () => {
    const days = (month: string, n: number, score: number) =>
      Array.from({ length: n }, (_, i) => rec(`2025-${month}-${String(i + 1).padStart(2, "0")}`, score));
    const r = buildYearReview(2025, "2026-11-27", {
      ...empty,
      recovery: [...days("01", 5, 70), ...days("02", 4, 99), ...days("03", 6, 40), ...days("04", 5, 70)],
    });
    expect(r.bestMonth?.label).toBe("January");
    expect(r.worstMonth?.label).toBe("March");
    expect(r.months[1].scoredDays).toBe(4);
  });

  it("aggregates workouts: totals, zone 1–5 minutes (zone 0 excluded), top sports", () => {
    const r = buildYearReview(2025, "2026-11-27", {
      ...empty,
      workouts: [
        wo("2025-01-01", "Running", 30, 10),
        wo("2025-01-01", "Running", 45, 20),
        wo("2025-01-02", "Cycling", 90, 60),
        wo("2025-01-03", null, 20),
        wo("2025-01-03", "  ", 10),
      ],
    });
    expect(r.workouts.count).toBe(5);
    expect(r.workouts.minutes).toBe(195);
    expect(r.workouts.zoneMinutes).toEqual([0, 90, 0, 0, 0]);
    // Count first, then minutes; null and blank sports fold into "Other".
    expect(r.workouts.topSports).toEqual([
      { sport: "Running", count: 2, minutes: 75 },
      { sport: "Other", count: 2, minutes: 30 },
      { sport: "Cycling", count: 1, minutes: 90 },
    ]);
  });

  it("caps top sports at five", () => {
    const sports = ["A", "B", "C", "D", "E", "F", "G"];
    const r = buildYearReview(2025, "2026-11-27", {
      ...empty,
      workouts: sports.map((s) => wo("2025-02-01", s, 10)),
    });
    expect(r.workouts.topSports.map((s) => s.sport)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("sleep consistency trend needs two months with enough nights", () => {
    const nights = (month: string, n: number, c: number) =>
      Array.from({ length: n }, (_, i) => slp(`2025-${month}-${String(i + 1).padStart(2, "0")}`, 7, c));
    const thin = buildYearReview(2025, "2026-11-27", { ...empty, sleep: [...nights("01", 5, 60), ...nights("02", 4, 90)] });
    expect(thin.consistencyTrend).toBeNull();

    const r = buildYearReview(2025, "2026-11-27", {
      ...empty,
      sleep: [...nights("01", 5, 60), ...nights("06", 5, 70), ...nights("11", 6, 82)],
    });
    expect(r.consistencyTrend).toEqual({
      from: { label: "January", value: 60 },
      to: { label: "November", value: 82 },
      delta: 22,
    });
    expect(r.highlights).toContain("Sleep consistency rose from 60% in January to 82% in November.");
  });

  it("personal bests break ties toward the earliest date", () => {
    const r = buildYearReview(2025, "2026-11-27", {
      ...empty,
      recovery: [rec("2025-05-02", 50, 90, 48), rec("2025-05-01", 50, 90, 48)],
    });
    expect(r.personalBests.highestHrv?.date).toBe("2025-05-01");
    expect(r.personalBests.lowestRhr?.date).toBe("2025-05-01");
  });

  it("highlights are deterministic and capped at five", () => {
    const input = {
      recovery: Array.from({ length: 40 }, (_, i) => {
        const d = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
        return rec(d, i < 10 ? 80 : 50, 40 + i, 60 - (i % 7));
      }),
      sleep: Array.from({ length: 40 }, (_, i) => {
        const d = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
        return slp(d, 7, i < 31 ? 70 : 85);
      }),
      cycles: [cyc("2025-01-15", 18.4)],
      workouts: [wo("2025-01-03", "Running", 60)],
    };
    const a = buildYearReview(2025, "2026-11-27", input);
    const b = buildYearReview(2025, "2026-11-27", input);
    expect(a.highlights).toEqual(b.highlights);
    expect(a.highlights).toHaveLength(5);
    expect(a.highlights).toEqual([
      "You were scored on 40 days — 11% of 2025.",
      "January was your strongest month, averaging 60% recovery.",
      "Your longest green run was 10 days in a row (Jan 1 – Jan 10).",
      "You logged 1 workout over 1 hour; Running led with 1 session.",
      "Sleep consistency rose from 70% in January to 85% in February.",
    ]);
  });
});
