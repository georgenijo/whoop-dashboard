import { describe, expect, it } from "vitest";
import {
  GOALS_STORAGE_KEY,
  GOALS_WINDOW_DAYS,
  GOAL_SPECS,
  addDays,
  defaultGoalConfig,
  evaluateGoals,
  goalsWindowStart,
  isIsoDate,
  isValidValue,
  parseStoredGoals,
  serializeGoals,
  startOfWeek,
  type GoalConfig,
  type GoalDayRow,
  type GoalKind,
} from "./goals";

function row(date: string, over: Partial<GoalDayRow> = {}): GoalDayRow {
  return {
    date,
    recovery_score: null,
    resting_hr: null,
    sleep_hours: null,
    sleep_performance: null,
    day_strain: null,
    workouts_count: null,
    ...over,
  };
}

/** Only the given goal enabled. */
function only(kind: GoalKind, over: Partial<GoalConfig[GoalKind]> = {}): GoalConfig {
  const c = defaultGoalConfig();
  for (const k of Object.keys(c) as GoalKind[]) c[k] = { ...c[k], enabled: false };
  c[kind] = { ...c[kind], enabled: true, ...over };
  return c;
}

function days(start: string, n: number, f: (d: string, i: number) => Partial<GoalDayRow>): GoalDayRow[] {
  return Array.from({ length: n }, (_, i) => {
    const d = addDays(start, i);
    return row(d, f(d, i));
  });
}

function evalOne(kind: GoalKind, rows: GoalDayRow[], today: string, over: Partial<GoalConfig[GoalKind]> = {}, weekStart?: number) {
  const res = evaluateGoals({ rows, today, config: only(kind, over), weekStart });
  expect(res).toHaveLength(1);
  return res[0];
}

describe("dates", () => {
  it("weeks start on Monday by default and honour another week start", () => {
    // 2026-11-28 is a Saturday.
    expect(startOfWeek("2026-11-28")).toBe("2026-11-23");
    expect(startOfWeek("2026-11-23")).toBe("2026-11-23");
    expect(startOfWeek("2026-11-22")).toBe("2026-11-16"); // Sunday belongs to the prior week
    expect(startOfWeek("2026-11-28", 0)).toBe("2026-11-22");
    expect(startOfWeek("2026-11-28", 6)).toBe("2026-11-28");
    expect(startOfWeek("2026-11-28", 9)).toBe("2026-11-23"); // invalid → Monday
  });

  it("crosses DST changes and year ends without drifting", () => {
    // US DST start 2026-03-08, end 2026-11-01 — both Sundays.
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(startOfWeek("2026-03-08")).toBe("2026-03-02");
    expect(startOfWeek("2026-11-01")).toBe("2026-10-26");
    expect(startOfWeek("2027-01-01")).toBe("2026-12-28");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("validates ISO dates strictly", () => {
    expect(isIsoDate("2026-11-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-1-1")).toBe(false);
    expect(isIsoDate(20261128)).toBe(false);
  });

  it("window covers exactly GOALS_WINDOW_DAYS days", () => {
    expect(goalsWindowStart("2026-11-28")).toBe(addDays("2026-11-28", -(GOALS_WINDOW_DAYS - 1)));
  });
});

describe("storage parsing", () => {
  it("falls back to defaults for missing, corrupt or wrong-version data", () => {
    const d = defaultGoalConfig();
    for (const raw of [null, undefined, "", "not json", "[]", "null", "42", '{"version":2,"goals":{}}', '{"version":1}', '{"version":1,"goals":[]}', "x".repeat(5000)]) {
      expect(parseStoredGoals(raw as string | null)).toEqual(d);
    }
  });

  it("keeps valid goals and resets only the invalid ones", () => {
    const raw = JSON.stringify({
      version: 1,
      goals: {
        sleepHours: { enabled: false, target: 8 },
        sleepPerformance: { enabled: true, target: 101 }, // out of range
        recoveryDays: { enabled: true, target: 70, days: 8 }, // bad days
        workouts: { enabled: "yes", target: 4 }, // bad enabled
        weeklyStrain: { enabled: true, target: 90.5 }, // off step
        restingHr: { enabled: true, target: 52 },
        hacked: { enabled: true, target: 1 },
      },
    });
    const c = parseStoredGoals(raw);
    const d = defaultGoalConfig();
    expect(c.sleepHours).toEqual({ enabled: false, target: 8 });
    expect(c.sleepPerformance).toEqual(d.sleepPerformance);
    expect(c.recoveryDays).toEqual(d.recoveryDays);
    expect(c.workouts).toEqual(d.workouts);
    expect(c.weeklyStrain).toEqual(d.weeklyStrain);
    expect(c.restingHr).toEqual({ enabled: true, target: 52 });
    expect(Object.keys(c).sort()).toEqual(Object.keys(d).sort());
  });

  it("rejects NaN, Infinity, strings and extra precision", () => {
    const r = GOAL_SPECS.sleepHours.target;
    expect(isValidValue(7.25, r)).toBe(true);
    expect(isValidValue(7.3, r)).toBe(false);
    expect(isValidValue(Number.NaN, r)).toBe(false);
    expect(isValidValue(Infinity, r)).toBe(false);
    expect(isValidValue("7", r)).toBe(false);
    expect(isValidValue(3.75, r)).toBe(false);
  });

  it("round-trips through serializeGoals and drops invalid values", () => {
    const c = defaultGoalConfig();
    c.workouts = { enabled: true, target: 5 };
    expect(parseStoredGoals(serializeGoals(c))).toEqual(c);
    const bad = { ...c, workouts: { enabled: true, target: 999 } };
    expect(parseStoredGoals(serializeGoals(bad)).workouts).toEqual(defaultGoalConfig().workouts);
    expect(GOALS_STORAGE_KEY).toMatch(/v1$/);
  });
});

describe("evaluateGoals", () => {
  const today = "2026-11-28"; // Saturday; Monday-start week = Nov 23..28, 6 days elapsed

  it("returns nothing for an invalid today and only enabled goals otherwise", () => {
    expect(evaluateGoals({ rows: [], today: "nope", config: defaultGoalConfig() })).toEqual([]);
    const res = evaluateGoals({ rows: [], today, config: defaultGoalConfig() });
    expect(res.map((g) => g.kind)).toEqual(["sleepHours", "sleepPerformance", "recoveryDays", "workouts"]);
  });

  it("empty data: every goal is no data with zero progress and no streak", () => {
    const res = evaluateGoals({ rows: [], today, config: defaultGoalConfig() });
    for (const g of res) {
      expect(g.status).toBe("noData");
      expect(g.progress).toBe(0);
      expect(g.currentStreak).toBe(0);
      expect(g.bestStreak).toBe(0);
      expect(g.daysElapsed).toBe(6);
      expect(g.weeks.at(-1)?.start).toBe("2026-11-23");
    }
  });

  it("a single day of data drives the current week", () => {
    const g = evalOne("sleepHours", [row(today, { sleep_hours: 8 })], today);
    expect(g.status).toBe("onTrack");
    expect(g.current.value).toBe(8);
    expect(g.progress).toBe(1);
    const b = evalOne("sleepHours", [row(today, { sleep_hours: 6 })], today);
    expect(b.status).toBe("behind");
    expect(b.progress).toBeCloseTo(6 / 7.5);
  });

  it("treats 0 sleep hours and null as missing, not as zero", () => {
    const g = evalOne("sleepHours", [row("2026-11-27", { sleep_hours: 0 }), row(today, { sleep_hours: null })], today);
    expect(g.status).toBe("noData");
    expect(g.current.daysWithData).toBe(0);
  });

  it("averages only the days with data across gaps", () => {
    const rows = [row("2026-11-23", { sleep_performance: 90 }), row("2026-11-26", { sleep_performance: 80 })];
    const g = evalOne("sleepPerformance", rows, today);
    expect(g.current.value).toBe(85);
    expect(g.current.daysWithData).toBe(2);
    expect(g.status).toBe("onTrack");
  });

  it("an average is met only on the final day of the week", () => {
    const sunday = "2026-11-29";
    const rows = days("2026-11-23", 7, () => ({ sleep_hours: 8 }));
    expect(evalOne("sleepHours", rows, today).status).toBe("onTrack");
    expect(evalOne("sleepHours", rows, sunday).status).toBe("met");
  });

  it("resting HR is a lower-is-better goal", () => {
    const g = evalOne("restingHr", [row(today, { resting_hr: 55 })], today, { target: 60 });
    expect(g.status).toBe("onTrack");
    expect(g.progress).toBe(1);
    const b = evalOne("restingHr", [row(today, { resting_hr: 66 })], today, { target: 60 });
    expect(b.status).toBe("behind");
    expect(b.progress).toBeCloseTo(60 / 66);
  });

  it("workouts: met at target, on pace, or behind", () => {
    const mon = "2026-11-23";
    expect(evalOne("workouts", [row(mon, { workouts_count: 3 })], today, { target: 3 }).status).toBe("met");
    // Tuesday (2 of 7 days): 1 workout vs 3×2/7 = 0.86 → on track.
    expect(evalOne("workouts", [row(mon, { workouts_count: 1 })], "2026-11-24", { target: 3 }).status).toBe("onTrack");
    // Saturday (6 of 7): 1 workout vs 2.57 → behind.
    expect(evalOne("workouts", days(mon, 6, (_, i) => ({ workouts_count: i === 0 ? 1 : 0 })), today, { target: 3 }).status).toBe("behind");
  });

  it("weekly strain sums day strain", () => {
    const g = evalOne("weeklyStrain", days("2026-11-23", 6, () => ({ day_strain: 12.5 })), today, { target: 70 });
    expect(g.current.value).toBe(75);
    expect(g.status).toBe("met");
  });

  it("recovery days counts threshold days and flags an unreachable week", () => {
    const rows = days("2026-11-23", 6, (_, i) => ({ recovery_score: i < 2 ? 80 : 40 }));
    // Saturday: 2 qualifying days, 1 day left, need 4 → behind.
    const g = evalOne("recoveryDays", rows, today, { target: 67, days: 4 });
    expect(g.current.value).toBe(2);
    expect(g.status).toBe("behind");
    expect(g.progress).toBe(0.5);
    // Threshold is inclusive.
    const met = evalOne("recoveryDays", days("2026-11-23", 6, () => ({ recovery_score: 67 })), today, { target: 67, days: 4 });
    expect(met.status).toBe("met");
  });

  it("counts current and best streaks across completed weeks", () => {
    // Weeks (Mon starts): 6 weeks back … current. Pattern for workouts ≥3:
    // Oct 19 met, Oct 26 met, Nov 2 met, Nov 9 missed, Nov 16 met, current (Nov 23) met.
    const weeks: Record<string, number> = {
      "2026-10-19": 3,
      "2026-10-26": 4,
      "2026-11-02": 3,
      "2026-11-09": 1,
      "2026-11-16": 3,
      "2026-11-23": 3,
    };
    const rows = Object.entries(weeks).map(([d, n]) => row(d, { workouts_count: n }));
    const g = evalOne("workouts", rows, today, { target: 3 });
    expect(g.currentStreak).toBe(2);
    expect(g.bestStreak).toBe(3);
  });

  it("an in-progress current week neither extends nor breaks the streak", () => {
    const rows = [row("2026-11-09", { workouts_count: 3 }), row("2026-11-16", { workouts_count: 3 })];
    const g = evalOne("workouts", rows, "2026-11-24", { target: 3 });
    expect(g.status).toBe("noData"); // Tuesday, nothing synced this week yet
    expect(g.currentStreak).toBe(2);
    expect(g.bestStreak).toBe(2);
    const behind = evalOne("workouts", [...rows, row("2026-11-23", { workouts_count: 0 })], "2026-11-24", { target: 3 });
    expect(behind.status).toBe("behind");
    expect(behind.currentStreak).toBe(2);
  });

  it("a completed week with too few readings counts as no data and breaks the streak", () => {
    const rows = [
      ...days("2026-11-09", 7, () => ({ sleep_hours: 8 })),
      row("2026-11-16", { sleep_hours: 9 }),
      row("2026-11-17", { sleep_hours: 9 }),
      row(today, { sleep_hours: 8 }),
    ];
    const g = evalOne("sleepHours", rows, today);
    const last = g.weeks.at(-2)!;
    expect(last.start).toBe("2026-11-16");
    expect(last.noData).toBe(true);
    expect(last.met).toBe(false);
    expect(g.currentStreak).toBe(0);
    expect(g.bestStreak).toBe(1);
  });

  it("only uses completed weeks wholly inside the 90-day window", () => {
    const g = evalOne("workouts", [], today);
    const start = goalsWindowStart(today);
    expect(g.weeks[0].start >= start).toBe(true);
    expect(addDays(g.weeks[0].start, -7) < start).toBe(true);
    for (let i = 1; i < g.weeks.length; i++) expect(g.weeks[i].start).toBe(addDays(g.weeks[i - 1].start, 7));
  });

  it("ignores rows outside the window, after today, or with bad dates; last duplicate wins", () => {
    const rows = [
      row(addDays(goalsWindowStart(today), -1), { workouts_count: 9 }),
      row("2026-11-29", { workouts_count: 9 }),
      row("garbage", { workouts_count: 9 }),
      row("2026-11-24", { workouts_count: 9 }),
      row("2026-11-24", { workouts_count: 1 }),
    ];
    const g = evalOne("workouts", rows, today, { target: 3 });
    expect(g.current.value).toBe(1);
  });

  it("a week spanning the DST change still has seven days", () => {
    // Week of Oct 26 – Nov 1 2026 contains the US fall-back Sunday.
    const rows = days("2026-10-26", 7, () => ({ workouts_count: 1 }));
    const g = evalOne("workouts", rows, "2026-11-03", { target: 7 });
    const w = g.weeks.find((x) => x.start === "2026-10-26")!;
    expect(w.end).toBe("2026-11-01");
    expect(w.value).toBe(7);
    expect(w.met).toBe(true);
  });

  it("honours a Sunday week start", () => {
    const g = evalOne("workouts", [row("2026-11-22", { workouts_count: 3 })], today, { target: 3 }, 0);
    expect(g.current.start).toBe("2026-11-22");
    expect(g.daysElapsed).toBe(7);
    expect(g.status).toBe("met");
  });
});
