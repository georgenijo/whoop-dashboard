import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALENDAR_WEEKS,
  MIN_SCORED_DAYS_FOR_MONTH,
  addDays,
  buildRecoveryCalendar,
  describeCalendar,
  isRecoveryCalendarEnabled,
  startOfWeek,
  windowStartFor,
  type CalendarInputRow,
} from "./recoveryCalendar";

const row = (date: string, recovery_score: number | null, hrv: number | null = 60, rhr: number | null = 50): CalendarInputRow => ({
  date,
  recovery_score,
  hrv,
  rhr,
});

/** `n` consecutive days ending on `end`, all with `score`. */
function run(end: string, n: number, score: number): CalendarInputRow[] {
  return Array.from({ length: n }, (_, i) => row(addDays(end, -(n - 1 - i)), score));
}

const cellsInWindow = (cal: ReturnType<typeof buildRecoveryCalendar>) => cal.weeks.flat().filter((c) => c.inWindow);

describe("isRecoveryCalendarEnabled", () => {
  it("is on only for exactly '1'", () => {
    expect(isRecoveryCalendarEnabled({})).toBe(false);
    expect(isRecoveryCalendarEnabled({ RECOVERY_CALENDAR: "" })).toBe(false);
    expect(isRecoveryCalendarEnabled({ RECOVERY_CALENDAR: "0" })).toBe(false);
    expect(isRecoveryCalendarEnabled({ RECOVERY_CALENDAR: "true" })).toBe(false);
    expect(isRecoveryCalendarEnabled({ RECOVERY_CALENDAR: "1" })).toBe(true);
  });
});

describe("date helpers", () => {
  it("windowStartFor: day after the same date a year earlier", () => {
    expect(windowStartFor("2026-11-27")).toBe("2025-11-28");
    expect(windowStartFor("2026-01-01")).toBe("2025-01-02");
    expect(windowStartFor("2026-12-31")).toBe("2026-01-01");
  });

  it("windowStartFor: leap days", () => {
    // Feb 29 → previous year has no Feb 29, clamps to Feb 28, window starts Mar 1.
    expect(windowStartFor("2028-02-29")).toBe("2027-03-01");
    // Window spanning Feb 29 2028 is 366 days.
    expect(windowStartFor("2028-03-01")).toBe("2027-03-02");
    expect(buildRecoveryCalendar([], "2028-03-01").daysInWindow).toBe(366);
    expect(buildRecoveryCalendar([], "2026-11-27").daysInWindow).toBe(365);
    expect(buildRecoveryCalendar([], "2028-02-29").daysInWindow).toBe(366);
  });

  it("startOfWeek respects Monday- and Sunday-first", () => {
    // 2026-11-27 is a Friday.
    expect(startOfWeek("2026-11-27", 1)).toBe("2026-11-23");
    expect(startOfWeek("2026-11-27", 0)).toBe("2026-11-22");
    expect(startOfWeek("2026-11-23", 1)).toBe("2026-11-23");
    expect(startOfWeek("2026-11-22", 1)).toBe("2026-11-16");
  });

  it("addDays crosses US DST transitions without skipping or repeating", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  });
});

describe("buildRecoveryCalendar — grid shape", () => {
  it("rejects an invalid today", () => {
    expect(() => buildRecoveryCalendar([], "2026-02-30")).toThrow();
    expect(() => buildRecoveryCalendar([], "nope")).toThrow();
  });

  it("is 53 x 7, consecutive dates, last column holds today, Monday-first rows", () => {
    const cal = buildRecoveryCalendar([], "2026-11-27");
    expect(cal.weeks).toHaveLength(CALENDAR_WEEKS);
    for (const w of cal.weeks) expect(w).toHaveLength(7);
    const flat = cal.weeks.flat();
    for (let i = 1; i < flat.length; i++) expect(flat[i].date).toBe(addDays(flat[i - 1].date, 1));
    expect(cal.weekdayLabels).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(cal.weeks[0][0].date).toBe(startOfWeek(cal.weeks[0][0].date, 1));
    const last = cal.weeks[CALENDAR_WEEKS - 1];
    expect(last.map((c) => c.date)).toContain("2026-11-27");
  });

  it("pads the partial first and last weeks as out-of-window", () => {
    const cal = buildRecoveryCalendar([], "2026-11-27"); // Friday
    const last = cal.weeks[CALENDAR_WEEKS - 1];
    expect(last.map((c) => c.inWindow)).toEqual([true, true, true, true, true, false, false]);
    expect(last[5].label).toBe("");
    const first = cal.weeks.flat().filter((c) => c.date < cal.windowStart);
    expect(first.every((c) => !c.inWindow)).toBe(true);
    expect(cellsInWindow(cal)).toHaveLength(cal.daysInWindow);
    expect(cellsInWindow(cal)[0].date).toBe("2025-11-28");
  });

  it("supports Sunday-first weeks", () => {
    const cal = buildRecoveryCalendar([], "2026-11-27", 0);
    expect(cal.weekdayLabels[0]).toBe("Sun");
    expect(new Date(`${cal.weeks[0][0].date}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(cal.weeks[CALENDAR_WEEKS - 1].map((c) => c.inWindow)).toEqual([true, true, true, true, true, true, false]);
  });

  it("never drops a day of a 366-day window, whatever weekday today is", () => {
    for (let i = 0; i < 7; i++) {
      const today = addDays("2028-03-01", i);
      const cal = buildRecoveryCalendar([], today);
      // 2028-03-06 is a Monday: 1 day in the last column + 365 before it needs 54.
      expect(cal.weeks).toHaveLength(today === "2028-03-06" ? 54 : 53);
      expect(cellsInWindow(cal)[0].date).toBe(cal.windowStart);
      expect(cellsInWindow(cal)).toHaveLength(cal.daysInWindow);
    }
  });

  it("puts month labels on the column holding each 1st, plus the opening month", () => {
    const cal = buildRecoveryCalendar([], "2026-11-27");
    const labels = cal.monthLabels.map((m) => m.label);
    // Window opens Fri Nov 28 2025; Dec 1 is the very next column, so the
    // opening "Nov" label is dropped to avoid overlapping "Dec".
    expect(labels[0]).toBe("Dec");
    expect(cal.monthLabels[0].column).toBe(1);
    expect(labels.filter((l) => l === "Nov")).toHaveLength(1);
    // Mid-month opening with room: window opens Jun 15 2025, Jul 1 is 3 columns on.
    const mid = buildRecoveryCalendar([], "2026-06-14");
    expect(mid.monthLabels[0]).toEqual({ column: 0, label: "Jun" });
    expect(mid.monthLabels[1].label).toBe("Jul");
    expect(labels.at(-1)).toBe("Nov");
    const nov1 = cal.weeks.findIndex((w) => w.some((c) => c.date === "2026-11-01"));
    expect(cal.monthLabels.at(-1)!.column).toBe(nov1);
    // Columns strictly increase.
    for (let i = 1; i < cal.monthLabels.length; i++) {
      expect(cal.monthLabels[i].column).toBeGreaterThan(cal.monthLabels[i - 1].column);
    }
  });
});

describe("buildRecoveryCalendar — data", () => {
  it("empty data: everything empty, no streaks or months", () => {
    const cal = buildRecoveryCalendar([], "2026-11-27");
    expect(cal.daysScored).toBe(0);
    expect(cal.coveragePct).toBe(0);
    expect(cal.currentGreenStreak.length).toBe(0);
    expect(cal.longestGreenStreak).toEqual({ length: 0, start: null, end: null });
    expect(cal.bestMonth).toBeNull();
    expect(cal.worstMonth).toBeNull();
    expect(cellsInWindow(cal).every((c) => c.band === null)).toBe(true);
    expect(describeCalendar(cal)).toMatch(/no scored days/);
  });

  it("one day: a single scored cell with its tooltip text", () => {
    const cal = buildRecoveryCalendar([row("2026-11-27", 72.4, 61.2, 51.6)], "2026-11-27");
    expect(cal.daysScored).toBe(1);
    expect(cal.coveragePct).toBe(0);
    const cell = cal.scoredDays[0];
    expect(cell.band).toBe("high");
    expect(cell.label).toBe("Fri, Nov 27, 2026: recovery 72% (High) · HRV 61 ms · RHR 52 bpm");
    expect(cal.currentGreenStreak).toEqual({ length: 1, start: "2026-11-27", end: "2026-11-27" });
    expect(cal.bestMonth).toBeNull(); // below MIN_SCORED_DAYS_FOR_MONTH
  });

  it("uses recoveryBand thresholds (67 high, 34 mid)", () => {
    const cal = buildRecoveryCalendar(
      [row("2026-11-20", 67), row("2026-11-21", 66), row("2026-11-22", 34), row("2026-11-23", 33)],
      "2026-11-27",
    );
    expect(cal.scoredDays.map((c) => c.band)).toEqual(["high", "mid", "mid", "low"]);
    expect(cal.bandCounts).toEqual({ high: 1, mid: 2, low: 1 });
  });

  it("nulls: a row with no score is an empty cell but keeps HRV/RHR in its label", () => {
    const cal = buildRecoveryCalendar([row("2026-11-26", null, 55, null)], "2026-11-27");
    const cell = cal.weeks.flat().find((c) => c.date === "2026-11-26")!;
    expect(cell.band).toBeNull();
    expect(cell.label).toBe("Thu, Nov 26, 2026: no recovery score · HRV 55 ms");
    expect(cal.daysScored).toBe(0);
  });

  it("ignores rows outside the window, malformed dates and non-finite scores", () => {
    const cal = buildRecoveryCalendar(
      [
        row("2025-11-27", 90), // the day before the window
        row("2026-11-28", 90), // tomorrow
        row("2026-13-01", 90),
        row("2026-11-20", Number.NaN),
        row("2025-11-28", 90), // first in-window day
      ],
      "2026-11-27",
    );
    expect(cal.scoredDays.map((c) => c.date)).toEqual(["2025-11-28"]);
  });

  it("gaps break green streaks; longest and current tracked separately", () => {
    const rows = [
      ...run("2026-10-10", 9, 80), // longest: Oct 2–10
      // Oct 11 missing
      row("2026-10-12", 90),
      row("2026-11-24", 50), // mid breaks
      ...run("2026-11-27", 3, 75), // current: Nov 25–27
    ];
    const cal = buildRecoveryCalendar(rows, "2026-11-27");
    expect(cal.longestGreenStreak).toEqual({ length: 9, start: "2026-10-02", end: "2026-10-10" });
    expect(cal.currentGreenStreak).toEqual({ length: 3, start: "2026-11-25", end: "2026-11-27" });
  });

  it("current streak counts from yesterday when today is not scored yet", () => {
    const cal = buildRecoveryCalendar(run("2026-11-26", 4, 80), "2026-11-27");
    expect(cal.currentGreenStreak).toEqual({ length: 4, start: "2026-11-23", end: "2026-11-26" });
  });

  it("current streak is 0 when today is scored and not green", () => {
    const cal = buildRecoveryCalendar([...run("2026-11-26", 4, 80), row("2026-11-27", 40)], "2026-11-27");
    expect(cal.currentGreenStreak.length).toBe(0);
  });

  it("streaks cross month, year and DST boundaries", () => {
    const cal = buildRecoveryCalendar(run("2026-01-03", 8, 80), "2026-11-27"); // Dec 27 – Jan 3
    expect(cal.longestGreenStreak).toEqual({ length: 8, start: "2025-12-27", end: "2026-01-03" });
    const dst = buildRecoveryCalendar(run("2026-11-03", 5, 80), "2026-11-27"); // spans Nov 1 fall-back
    expect(dst.longestGreenStreak.length).toBe(5);
    const spring = buildRecoveryCalendar(run("2026-03-10", 5, 80), "2026-11-27"); // spans Mar 8 spring-forward
    expect(spring.longestGreenStreak.length).toBe(5);
  });

  it("streak at the very start of the window", () => {
    const cal = buildRecoveryCalendar(run("2025-11-30", 3, 80), "2026-11-27");
    expect(cal.longestGreenStreak).toEqual({ length: 3, start: "2025-11-28", end: "2025-11-30" });
  });

  it("best/worst month need MIN_SCORED_DAYS_FOR_MONTH scored days", () => {
    const rows = [
      ...run(`2026-06-${String(MIN_SCORED_DAYS_FOR_MONTH).padStart(2, "0")}`, MIN_SCORED_DAYS_FOR_MONTH, 80),
      ...run("2026-07-10", MIN_SCORED_DAYS_FOR_MONTH, 30),
      ...run("2026-08-20", MIN_SCORED_DAYS_FOR_MONTH - 1, 99), // too few to count
    ];
    const cal = buildRecoveryCalendar(rows, "2026-11-27");
    expect(cal.bestMonth?.month).toBe("2026-06");
    expect(cal.bestMonth?.average).toBe(80);
    expect(cal.worstMonth?.month).toBe("2026-07");
    expect(cal.worstMonth?.label).toBe("Jul 2026");
    const aug = cal.months.find((m) => m.month === "2026-08")!;
    expect(aug.scored).toBe(MIN_SCORED_DAYS_FOR_MONTH - 1);
    expect(aug.daysInWindow).toBe(31);
  });

  it("a single qualifying month is best but not worst", () => {
    const cal = buildRecoveryCalendar(run("2026-11-27", 10, 60), "2026-11-27");
    expect(cal.bestMonth?.month).toBe("2026-11");
    expect(cal.worstMonth).toBeNull();
  });

  it("months cover partial first/last months of the window", () => {
    const cal = buildRecoveryCalendar([], "2026-11-27");
    expect(cal.months[0]).toMatchObject({ month: "2025-11", daysInWindow: 3 });
    expect(cal.months.at(-1)).toMatchObject({ month: "2026-11", daysInWindow: 27 });
    expect(cal.months).toHaveLength(13);
    expect(cal.months.reduce((n, m) => n + m.daysInWindow, 0)).toBe(365);
  });

  it("coverage counts scored days over window days", () => {
    const cal = buildRecoveryCalendar(run("2026-11-27", 73, 50), "2026-11-27");
    expect(cal.daysScored).toBe(73);
    expect(cal.coveragePct).toBe(20);
  });

  it("describeCalendar summarises counts, streaks and months", () => {
    const rows = [...run("2026-06-07", 7, 80), ...run("2026-07-07", 7, 30)];
    const text = describeCalendar(buildRecoveryCalendar(rows, "2026-11-27"));
    expect(text).toContain("14 of 365 days scored");
    expect(text).toContain("7 high, 0 mid, 7 low");
    expect(text).toContain("best month Jun 2026 (average 80%)");
    expect(text).toContain("worst month Jul 2026 (average 30%)");
  });
});

describe("buildRecoveryCalendar — server timezone independence", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("produces identical output whatever TZ the process runs in", () => {
    const rows = [...run("2026-03-10", 5, 80), ...run("2026-11-03", 5, 40)];
    const base = JSON.stringify(buildRecoveryCalendar(rows, "2026-11-27"));
    for (const tz of ["America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
      vi.stubEnv("TZ", tz);
      expect(JSON.stringify(buildRecoveryCalendar(rows, "2026-11-27"))).toBe(base);
    }
  });
});
