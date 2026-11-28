import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  METRIC_SPECS,
  addDays,
  asleepHours,
  buildHighlights,
  compareMetric,
  computeWeeklyReview,
  formatDay,
  weekWindows,
  type WeeklyInput,
} from "./weekly";
import type { RecoveryRow } from "@/lib/db/recovery";
import type { SleepRow } from "@/lib/db/sleep";
import type { CycleRow } from "@/lib/db/strain";
import type { WorkoutRow } from "@/lib/db/workouts";

const TODAY = "2026-11-27";

function rec(date: string, score: number | null, hrv: number | null = 50, rhr: number | null = 52): RecoveryRow {
  return { date, recovery_score: score, hrv, rhr, spo2: null, skin_temp: null };
}

const H = 3_600_000;

/** Night ending on `date` (wake day), going to bed at `bedHour` the evening before. */
function night(date: string, asleepH: number | null, bedHour = 23, overrides: Partial<SleepRow> = {}): SleepRow {
  const bedDate = bedHour >= 12 ? addDays(date, -1) : date;
  const hh = String(bedHour).padStart(2, "0");
  const wakeHour = (bedHour + Math.ceil(asleepH ?? 8)) % 24;
  return {
    date,
    in_bed_ms: asleepH == null ? null : asleepH * H + 0.3 * H,
    light_ms: asleepH == null ? null : asleepH * H * 0.5,
    deep_ms: asleepH == null ? null : asleepH * H * 0.25,
    rem_ms: asleepH == null ? null : asleepH * H * 0.25,
    awake_ms: asleepH == null ? null : 0.3 * H,
    sleep_need_ms: 8 * H,
    performance: 85,
    efficiency: 92,
    consistency: 70,
    disturbances: 3,
    cycles: 4,
    respiratory_rate: 15,
    need_from_baseline_ms: null,
    need_from_debt_ms: null,
    need_from_strain_ms: null,
    need_from_nap_ms: null,
    start_local: `${bedDate}T${hh}:00:00`,
    end_local: `${date}T${String(wakeHour).padStart(2, "0")}:00:00`,
    ...overrides,
  };
}

function cycle(date: string, strain: number | null): CycleRow {
  return { date, strain, kilojoule: 9000, avg_hr: 70, max_hr: 160 };
}

function workout(id: string, date: string, durationMin: number, zone2Min: number | null): WorkoutRow {
  return {
    id,
    date,
    sport: "running",
    duration_sec: durationMin * 60,
    avg_hr: 140,
    max_hr: 170,
    strain: 10,
    kilojoule: 1500,
    distance_m: null,
    zone_0_ms: null,
    zone_1_ms: null,
    zone_2_ms: zone2Min == null ? null : zone2Min * 60_000,
    zone_3_ms: null,
    zone_4_ms: null,
    zone_5_ms: null,
    start_utc: null,
    end_utc: null,
  };
}

/** Dates `today-offset` for offsets in [from, to]. */
function days(from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(addDays(TODAY, -i));
  return out;
}

function input(partial: Partial<WeeklyInput>): WeeklyInput {
  return { today: TODAY, recovery: [], sleep: [], cycles: [], workouts: [], ...partial };
}

describe("week windows", () => {
  it("covers today + 6 days and the 7 days before, inclusive", () => {
    expect(weekWindows(TODAY)).toEqual({
      current: { start: "2026-11-21", end: "2026-11-27" },
      previous: { start: "2026-11-14", end: "2026-11-20" },
    });
  });

  it("crosses month and year boundaries without the runtime timezone", () => {
    expect(weekWindows("2026-01-02")).toEqual({
      current: { start: "2025-12-27", end: "2026-01-02" },
      previous: { start: "2025-12-20", end: "2025-12-26" },
    });
    // DST change weekend in the US (Mar 8 2026) must not skip or repeat a date.
    expect(weekWindows("2026-03-10").current.start).toBe("2026-03-04");
  });

  it("assigns boundary dates to exactly one week", () => {
    const r = computeWeeklyReview(
      input({ recovery: [rec("2026-11-21", 90), rec("2026-11-20", 10), rec("2026-11-28", 50), rec("2026-11-13", 50)] }),
    );
    expect(r.currentScoredDays).toBe(1); // 11-21 in, 11-28 (future) out
    expect(r.previousScoredDays).toBe(1); // 11-20 in, 11-13 out
    expect(r.bestRecovery).toEqual({ date: "2026-11-21", value: 90 });
  });

  it("formats a calendar date as itself regardless of TZ", () => {
    expect(formatDay("2026-11-27")).toBe("Fri, Nov 27");
  });
});

describe("empty and sparse data", () => {
  it("empty input is flagged empty with no highlights", () => {
    const r = computeWeeklyReview(input({}));
    expect(r.empty).toBe(true);
    expect(r.comparable).toBe(false);
    expect(r.highlights).toEqual([]);
    expect(r.bestRecovery).toBeNull();
    expect(r.consistency).toBeNull();
    expect(r.workouts).toEqual({ count: 0, totalMin: 0, zone2Min: null });
    expect(r.metrics.every((m) => m.current == null && m.delta == null)).toBe(true);
  });

  it("only last week's data still counts this week as empty", () => {
    const r = computeWeeklyReview(input({ recovery: days(7, 13).map((d) => rec(d, 60)) }));
    expect(r.empty).toBe(true);
    expect(r.previousScoredDays).toBe(7);
  });

  it("a single day shows current values but no comparison and no worst day", () => {
    const r = computeWeeklyReview(input({ recovery: [rec(TODAY, 71, 48, 55)] }));
    expect(r.empty).toBe(false);
    expect(r.comparable).toBe(false);
    const recovery = r.metrics.find((m) => m.key === "recovery")!;
    expect(recovery.current).toBe(71);
    expect(recovery.delta).toBeNull();
    expect(recovery.direction).toBeNull();
    expect(r.bestRecovery).toEqual({ date: TODAY, value: 71 });
    expect(r.worstRecovery).toBeNull();
    expect(r.highlights.length).toBeGreaterThanOrEqual(1);
    expect(r.highlights).toContain("Best recovery was 71% on Fri, Nov 27");
  });

  it("needs >= 4 scored days in BOTH weeks to compare", () => {
    const three = computeWeeklyReview(
      input({ recovery: [...days(0, 2).map((d) => rec(d, 80)), ...days(7, 13).map((d) => rec(d, 40))] }),
    );
    expect(three.comparable).toBe(false);
    expect(three.metrics.find((m) => m.key === "recovery")!.delta).toBeNull();

    const four = computeWeeklyReview(
      input({ recovery: [...days(0, 3).map((d) => rec(d, 80)), ...days(7, 10).map((d) => rec(d, 40))] }),
    );
    expect(four.comparable).toBe(true);
    expect(four.metrics.find((m) => m.key === "recovery")!.delta).toBe(40);
  });

  it("null recovery scores are not scored days; nulls never become zeros", () => {
    const r = computeWeeklyReview(
      input({
        recovery: [...days(0, 3).map((d) => rec(d, null, null, null)), rec(addDays(TODAY, -4), 60, null, 50)],
      }),
    );
    expect(r.currentScoredDays).toBe(1);
    const hrv = r.metrics.find((m) => m.key === "hrv")!;
    expect(hrv.current).toBeNull();
    expect(hrv.currentN).toBe(0);
    expect(r.metrics.find((m) => m.key === "rhr")!.current).toBe(50);
  });

  it("gaps: per-metric comparison needs >= 4 values even when recovery is comparable", () => {
    const r = computeWeeklyReview(
      input({
        recovery: [...days(0, 4), ...days(7, 11)].map((d) => rec(d, 60)),
        // only 2 nights of sleep logged this week
        sleep: [...days(0, 1).map((d) => night(d, 7.5)), ...days(7, 11).map((d) => night(d, 7))],
      }),
    );
    expect(r.comparable).toBe(true);
    const sleep = r.metrics.find((m) => m.key === "sleepHours")!;
    expect(sleep.currentN).toBe(2);
    expect(sleep.delta).toBeNull();
    expect(sleep.current).toBeCloseTo(7.5);
  });
});

describe("thresholds and direction", () => {
  const spec = (k: string) => METRIC_SPECS.find((s) => s.key === k)!;
  const four = (v: number) => [v, v, v, v];

  it("changes under the threshold read as flat", () => {
    const m = compareMetric(spec("hrv"), four(52), four(50), true);
    expect(m.delta).toBe(2);
    expect(m.direction).toBe("flat");
    expect(m.tone).toBe("neutral");
  });

  it("a change exactly at the threshold counts, including fractional hours", () => {
    expect(compareMetric(spec("hrv"), four(53), four(50), true).direction).toBe("up");
    const sleep = compareMetric(spec("sleepHours"), four(7 + 20 / 60), four(7), true);
    expect(sleep.direction).toBe("up");
  });

  it("lower resting HR is good, higher is bad; strain is neutral either way", () => {
    expect(compareMetric(spec("rhr"), four(48), four(52), true).tone).toBe("good");
    expect(compareMetric(spec("rhr"), four(56), four(52), true).tone).toBe("bad");
    const strain = compareMetric(spec("strain"), four(14), four(10), true);
    expect(strain.direction).toBe("up");
    expect(strain.tone).toBe("neutral");
  });

  it("not comparable suppresses the delta even with enough values", () => {
    expect(compareMetric(spec("hrv"), four(60), four(50), false).delta).toBeNull();
  });
});

describe("sleep", () => {
  it("asleep hours prefer staged sleep, fall back to in-bed minus awake", () => {
    expect(asleepHours(night(TODAY, 7))).toBeCloseTo(7);
    expect(
      asleepHours(night(TODAY, 7, 23, { light_ms: null, in_bed_ms: 8 * H, awake_ms: 0.5 * H })),
    ).toBeCloseTo(7.5);
    expect(asleepHours(night(TODAY, null))).toBeNull();
  });

  it("counts short nights and reuses bedtime analytics for spread across midnight", () => {
    const bedHours = [22, 23, 0, 1, 23, 22, 0];
    const r = computeWeeklyReview(
      input({ sleep: days(0, 6).map((d, i) => night(d, i < 4 ? 6.5 : 7.5, bedHours[i])) }),
    );
    expect(r.sleepNights).toBe(7);
    expect(r.shortNights).toBe(4);
    expect(r.consistency).not.toBeNull();
    // 22:00..01:00 spans midnight; anchor-wrapped std dev stays ~1 h, not ~10 h.
    expect(r.consistency!.bedtimeStdMin).toBeGreaterThan(30);
    expect(r.consistency!.bedtimeStdMin).toBeLessThan(80);
    expect(r.highlights).toContain("You slept under 7 h on 4 of 7 nights");
  });

  it("fewer than 5 nights with times → no consistency figure", () => {
    const r = computeWeeklyReview(input({ sleep: days(0, 3).map((d) => night(d, 8)) }));
    expect(r.consistency).toBeNull();
  });
});

describe("workouts", () => {
  it("sums duration and zone-2, leaving zone-2 null when no workout reports it", () => {
    const r = computeWeeklyReview(
      input({
        workouts: [
          workout("a", TODAY, 45, 20),
          workout("b", addDays(TODAY, -2), 30, null),
          workout("old", addDays(TODAY, -8), 90, 60),
        ],
      }),
    );
    expect(r.workouts).toEqual({ count: 2, totalMin: 75, zone2Min: 20 });
    expect(r.highlights).toContain("2 workouts for 1 h 15 min, 20 min in zone 2");

    const none = computeWeeklyReview(input({ workouts: [workout("c", TODAY, 30, null)] }));
    expect(none.workouts.zone2Min).toBeNull();
  });
});

describe("highlights", () => {
  function fullWeeks(curHrv: number, prevHrv: number): WeeklyInput {
    return input({
      recovery: [
        ...days(0, 6).map((d, i) => rec(d, 60 + i, curHrv, 52)),
        ...days(7, 13).map((d, i) => rec(d, 60 + i, prevHrv, 52)),
      ],
      sleep: [...days(0, 6), ...days(7, 13)].map((d) => night(d, 7.5)),
      cycles: [...days(0, 6), ...days(7, 13)].map((d) => cycle(d, 11)),
    });
  }

  it("reports a real HRV change in plain language", () => {
    const r = computeWeeklyReview(fullWeeks(58, 50));
    expect(r.comparable).toBe(true);
    expect(r.highlights[0]).toBe("HRV is up 8 ms vs last week");
  });

  it("does not report noise as a trend and still yields 2–4 highlights", () => {
    const r = computeWeeklyReview(fullWeeks(51, 50));
    expect(r.highlights.some((h) => h.startsWith("HRV"))).toBe(false);
    expect(r.highlights.length).toBeGreaterThanOrEqual(2);
    expect(r.highlights.length).toBeLessThanOrEqual(4);
    expect(r.highlights).toContain("Recovery held steady vs last week");
  });

  it("caps at 4 and is deterministic", () => {
    const busy = input({
      recovery: [
        ...days(0, 6).map((d) => rec(d, 80, 65, 48)),
        ...days(7, 13).map((d) => rec(d, 50, 50, 55)),
      ],
      sleep: [
        ...days(0, 6).map((d, i) => night(d, 6, i % 2 ? 21 : 2)),
        ...days(7, 13).map((d) => night(d, 8)),
      ],
      workouts: [workout("w", TODAY, 60, 30)],
    });
    const a = computeWeeklyReview(busy);
    const b = computeWeeklyReview(busy);
    expect(a.highlights).toHaveLength(4);
    expect(a.highlights).toEqual(b.highlights);
    expect(a.highlights).toEqual([
      "HRV is up 15 ms vs last week",
      "Recovery is up 30 points vs last week",
      "Resting HR is down 7 bpm vs last week",
      "Average sleep is down 2 h vs last week",
    ]);
  });

  it("best/worst ties resolve to the earliest day regardless of row order", () => {
    const rows = [rec(TODAY, 70), rec(addDays(TODAY, -3), 70), rec(addDays(TODAY, -1), 40)];
    const r = computeWeeklyReview(input({ recovery: rows.reverse() }));
    expect(r.bestRecovery).toEqual({ date: addDays(TODAY, -3), value: 70 });
    expect(r.worstRecovery).toEqual({ date: addDays(TODAY, -1), value: 40 });
  });

  it("buildHighlights returns nothing for an empty review", () => {
    const r = computeWeeklyReview(input({}));
    expect(buildHighlights(r)).toEqual([]);
  });
});
