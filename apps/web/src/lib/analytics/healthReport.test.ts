import { describe, expect, it } from "vitest";
import type { RecoveryRow } from "@/lib/db/recovery";
import type { SleepRow } from "@/lib/db/sleep";
import type { CycleRow } from "@/lib/db/strain";
import type { WorkoutRow } from "@/lib/db/workouts";
import {
  DEFAULT_REPORT_DAYS,
  addDays,
  asleepMs,
  computeHealthReport,
  formatDuration,
  formatReportDate,
  parseReportDays,
  reportWindow,
  summarize,
} from "./healthReport";

const H = 3_600_000;

function rec(date: string, o: Partial<RecoveryRow> = {}): RecoveryRow {
  return { date, recovery_score: 60, hrv: 50, rhr: 52, spo2: null, skin_temp: null, ...o };
}
function slp(date: string, o: Partial<SleepRow> = {}): SleepRow {
  return {
    date,
    in_bed_ms: 8 * H,
    light_ms: 4 * H,
    deep_ms: 1.5 * H,
    rem_ms: 1.5 * H,
    awake_ms: H,
    sleep_need_ms: null,
    performance: 85,
    efficiency: 90,
    consistency: null,
    disturbances: null,
    cycles: null,
    respiratory_rate: 15,
    need_from_baseline_ms: null,
    need_from_debt_ms: null,
    need_from_strain_ms: null,
    need_from_nap_ms: null,
    start_local: null,
    end_local: null,
    ...o,
  };
}
function cyc(date: string, strain: number | null): CycleRow {
  return { date, strain, kilojoule: null, avg_hr: null, max_hr: null } as CycleRow;
}
function wo(id: string, date: string, duration_sec: number | null): WorkoutRow {
  return {
    id, date, sport: "running", duration_sec, avg_hr: null, max_hr: null, strain: null, kilojoule: null,
    distance_m: null, zone_0_ms: null, zone_1_ms: null, zone_2_ms: null, zone_3_ms: null, zone_4_ms: null,
    zone_5_ms: null, start_utc: null, end_utc: null,
  };
}

const base = { recovery: [], sleep: [], cycles: [], workouts: [] } as const;

describe("parseReportDays", () => {
  it.each([
    ["7", 7],
    ["30", 30],
    ["90", 90],
  ])("accepts %s", (raw, n) => expect(parseReportDays(raw)).toBe(n));

  it.each([undefined, "", "0", "1", "14", "365", "-7", "+7", "7.0", " 7", "07x", "1e1", "9999", "abc"])(
    "falls back to the default for %j",
    (raw) => expect(parseReportDays(raw as string | undefined)).toBe(DEFAULT_REPORT_DAYS),
  );

  it("rejects repeated params (?days=7&days=90)", () => {
    expect(parseReportDays(["7", "90"])).toBe(30);
  });

  it("treats a leading-zero allowlisted value as that value", () => {
    expect(parseReportDays("030")).toBe(30);
  });
});

describe("window / date math", () => {
  it("30-day window is today plus the 29 dates before", () => {
    expect(reportWindow("2026-11-27", 30)).toEqual({ start: "2026-10-29", end: "2026-11-27" });
  });

  it("is unaffected by DST transitions (US fall-back 2026-11-01, spring-forward 2026-03-08)", () => {
    expect(reportWindow("2026-11-05", 7)).toEqual({ start: "2026-10-30", end: "2026-11-05" });
    expect(reportWindow("2026-03-10", 7)).toEqual({ start: "2026-03-04", end: "2026-03-10" });
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
  });

  it("crosses month, year and leap-day boundaries", () => {
    expect(reportWindow("2027-01-03", 7).start).toBe("2026-12-28");
    expect(reportWindow("2028-03-01", 7).start).toBe("2028-02-24");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("rejects a malformed today", () => {
    expect(() => reportWindow("2026-11-27T00:00", 7)).toThrow();
  });

  it("formats dates at UTC so the server timezone cannot shift the day", () => {
    expect(formatReportDate("2026-11-01")).toBe("Sun, Nov 1");
    expect(formatReportDate("2026-11-27", true)).toBe("Fri, Nov 27, 2026");
  });

  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0 m");
    expect(formatDuration(45 * 60)).toBe("45 m");
    expect(formatDuration(3900)).toBe("1 h 05 m");
  });
});

describe("summarize / asleepMs", () => {
  it("returns null for no finite values", () => {
    expect(summarize([])).toBeNull();
    expect(summarize([{ date: "2026-01-01", value: null }, { date: "2026-01-02", value: NaN }])).toBeNull();
  });

  it("ties resolve to the earliest date", () => {
    const s = summarize([
      { date: "2026-01-01", value: 5 },
      { date: "2026-01-02", value: 5 },
    ])!;
    expect(s).toMatchObject({ avg: 5, min: 5, max: 5, minDate: "2026-01-01", maxDate: "2026-01-01", n: 2 });
  });

  it("asleepMs sums known stages, null when none are known", () => {
    expect(asleepMs({ light_ms: H, deep_ms: null, rem_ms: H })).toBe(2 * H);
    expect(asleepMs({ light_ms: null, deep_ms: null, rem_ms: null })).toBeNull();
  });
});

describe("computeHealthReport", () => {
  const today = "2026-11-27";

  it("empty period: every metric null, zero coverage, empty flag set", () => {
    const r = computeHealthReport({ today, days: 30, ...base });
    expect(r.empty).toBe(true);
    expect(r.coverage).toEqual({ days: 30, recoveryDays: 0, sleepNights: 0, strainDays: 0 });
    expect(r.metrics.every((m) => m.stat === null)).toBe(true);
    expect(r.workouts).toEqual({ count: 0, totalSec: 0 });
    expect(r.notable).toEqual({ bestRecovery: null, worstRecovery: null, longestSleep: null });
    expect(r.skinTempMaxDeviation).toBeNull();
  });

  it("a single day: best recovery shown, worst omitted (same day)", () => {
    const r = computeHealthReport({ today, days: 7, ...base, recovery: [rec(today, { recovery_score: 71 })] });
    expect(r.empty).toBe(false);
    expect(r.coverage.recoveryDays).toBe(1);
    expect(r.notable.bestRecovery).toEqual({ date: today, value: 71 });
    expect(r.notable.worstRecovery).toBeNull();
  });

  it("partial coverage with gaps: averages over recorded days only", () => {
    const recovery = [
      rec("2026-11-01", { recovery_score: 40 }),
      rec("2026-11-10", { recovery_score: 90 }),
      rec("2026-11-20", { recovery_score: 65 }),
    ];
    const r = computeHealthReport({ today, days: 30, ...base, recovery });
    const m = r.metrics.find((x) => x.key === "recovery")!.stat!;
    expect(m).toMatchObject({ avg: 65, min: 40, max: 90, minDate: "2026-11-01", maxDate: "2026-11-10", n: 3 });
    expect(r.coverage.recoveryDays).toBe(3);
    expect(r.notable.worstRecovery).toEqual({ date: "2026-11-01", value: 40 });
  });

  it("nulls in individual columns don't count as zero or as coverage", () => {
    const recovery = [
      rec("2026-11-25", { recovery_score: null, hrv: 60 }),
      rec("2026-11-26", { recovery_score: 80, hrv: null, rhr: null }),
    ];
    const sleep = [slp("2026-11-26", { light_ms: null, deep_ms: null, rem_ms: null, efficiency: null })];
    const r = computeHealthReport({ today, days: 7, ...base, recovery, sleep });
    const by = Object.fromEntries(r.metrics.map((m) => [m.key, m.stat]));
    expect(by.recovery).toMatchObject({ avg: 80, n: 1 });
    expect(by.hrv).toMatchObject({ avg: 60, n: 1 });
    expect(by.rhr).toMatchObject({ n: 1 });
    expect(by.sleepHours).toBeNull();
    expect(by.sleepEfficiency).toBeNull();
    expect(by.sleepPerformance).toMatchObject({ avg: 85, n: 1 });
    expect(r.coverage).toMatchObject({ recoveryDays: 1, sleepNights: 0 });
    expect(r.notable.longestSleep).toBeNull();
  });

  it("drops rows outside the window and duplicate dates", () => {
    const recovery = [
      rec("2026-11-20", { recovery_score: 10 }), // before 7-day window
      rec("2026-11-21", { recovery_score: 50 }), // first day of window
      rec("2026-11-21", { recovery_score: 99 }), // duplicate date
      rec("2026-11-28", { recovery_score: 99 }), // tomorrow
    ];
    const r = computeHealthReport({ today, days: 7, ...base, recovery });
    expect(r.start).toBe("2026-11-21");
    expect(r.metrics[0].stat).toMatchObject({ avg: 50, n: 1 });
  });

  it("sleep hours, longest sleep, respiratory rate", () => {
    const sleep = [
      slp("2026-11-25"), // 7 h asleep
      slp("2026-11-26", { light_ms: 5 * H, respiratory_rate: 16 }), // 8 h
    ];
    const r = computeHealthReport({ today, days: 7, ...base, sleep });
    const by = Object.fromEntries(r.metrics.map((m) => [m.key, m.stat]));
    expect(by.sleepHours).toMatchObject({ avg: 7.5, max: 8, maxDate: "2026-11-26" });
    expect(by.respiratoryRate).toMatchObject({ avg: 15.5 });
    expect(r.notable.longestSleep).toEqual({ date: "2026-11-26", value: 8 });
    expect(r.coverage.sleepNights).toBe(2);
  });

  it("skin temperature: null-only means no metric and no deviation", () => {
    const r = computeHealthReport({ today, days: 7, ...base, recovery: [rec(today)] });
    expect(r.metrics.find((m) => m.key === "skinTemp")!.stat).toBeNull();
    expect(r.skinTempMaxDeviation).toBeNull();
  });

  it("skin temperature: deviation is from the period mean, signed, largest magnitude", () => {
    const recovery = [
      rec("2026-11-24", { skin_temp: 33.0 }),
      rec("2026-11-25", { skin_temp: 33.2 }),
      rec("2026-11-26", { skin_temp: 34.2 }),
      rec("2026-11-27", { skin_temp: 33.2 }),
    ];
    const r = computeHealthReport({ today, days: 7, ...base, recovery });
    expect(r.skinTempMaxDeviation!.date).toBe("2026-11-26");
    expect(r.skinTempMaxDeviation!.value).toBeCloseTo(0.8, 5);
  });

  it("skin temperature: one reading gives a stat but no deviation", () => {
    const r = computeHealthReport({ today, days: 7, ...base, recovery: [rec(today, { skin_temp: 33.1 })] });
    expect(r.metrics.find((m) => m.key === "skinTemp")!.stat).toMatchObject({ n: 1 });
    expect(r.skinTempMaxDeviation).toBeNull();
  });

  it("workouts: count and total time, many per day, dedupe by id, null/negative durations add 0", () => {
    const workouts = [
      wo("a", "2026-11-26", 1800),
      wo("b", "2026-11-26", 2400),
      wo("b", "2026-11-26", 2400),
      wo("c", "2026-11-27", null),
      wo("d", "2026-11-27", -50),
      wo("old", "2026-11-01", 9999),
    ];
    const r = computeHealthReport({ today, days: 7, ...base, workouts });
    expect(r.workouts).toEqual({ count: 4, totalSec: 4200 });
    expect(r.empty).toBe(false);
  });

  it("strain coverage counts days with a strain value", () => {
    const cycles = [cyc("2026-11-26", 12.3), cyc("2026-11-27", null)];
    const r = computeHealthReport({ today, days: 7, ...base, cycles });
    expect(r.coverage.strainDays).toBe(1);
    expect(r.metrics.find((m) => m.key === "strain")!.stat).toMatchObject({ avg: 12.3 });
  });
});
