// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildWorkoutCalendar,
  monthGridBounds,
  monthQueryBounds,
  parseCalendarMonth,
  strainBand,
  type CalendarWorkoutInput,
} from "./workoutCalendar";

const w = (over: Partial<CalendarWorkoutInput> & { id: string }): CalendarWorkoutInput => ({
  date: "2026-11-10",
  sport: "Running",
  duration_sec: 3600,
  strain: 12,
  start_utc: null,
  ...over,
});

const day = (cal: ReturnType<typeof buildWorkoutCalendar>, date: string) =>
  cal.weeks.flat().find((d) => d.date === date)!;

describe("parseCalendarMonth", () => {
  const today = "2026-11-28";
  it.each([
    [undefined, "2026-11"],
    ["", "2026-11"],
    ["2026-11", "2026-11"],
    ["2026-01", "2026-01"],
    ["2012-01", "2012-01"],
    ["2011-12", "2026-11"], // before MIN_MONTH
    ["2026-12", "2026-11"], // future
    ["2030-01", "2026-11"], // far future
    ["2026-13", "2026-11"],
    ["2026-00", "2026-11"],
    ["2026-1", "2026-11"],
    ["2026-11-01", "2026-11"],
    ["abcd-ef", "2026-11"],
    [" 2026-10", "2026-11"],
  ])("%j → %s", (raw, want) => {
    expect(parseCalendarMonth(raw as string | undefined, today)).toBe(want);
  });
  it("rejects repeated params", () => {
    expect(parseCalendarMonth(["2026-10", "2026-09"], today)).toBe("2026-11");
  });
});

describe("monthGridBounds", () => {
  it("pads to Monday..Sunday (Nov 2026 starts on a Sunday)", () => {
    expect(monthGridBounds("2026-11")).toEqual({ start: "2026-10-26", end: "2026-12-06" });
  });
  it("needs no padding when the month starts Monday and ends Sunday (Feb 2027)", () => {
    expect(monthGridBounds("2027-02")).toEqual({ start: "2027-02-01", end: "2027-02-28" });
  });
  it("handles leap February", () => {
    expect(monthGridBounds("2028-02")).toEqual({ start: "2028-01-31", end: "2028-03-05" });
  });
  it("query bounds add one day each side", () => {
    expect(monthQueryBounds("2026-11")).toEqual({ start: "2026-10-25", end: "2026-12-07" });
  });
});

describe("strainBand", () => {
  it.each([
    [null, null],
    [Number.NaN, null],
    [0, "light"],
    [9.99, "light"],
    [10, "moderate"],
    [14, "high"],
    [18, "allout"],
    [21, "allout"],
  ])("%s → %s", (s, b) => expect(strainBand(s as number | null)).toBe(b));
});

describe("buildWorkoutCalendar", () => {
  it("empty month: full grid, all elapsed days are rest days, no stats", () => {
    const cal = buildWorkoutCalendar([], "2026-10", "2026-11-28", "America/New_York");
    expect(cal.title).toBe("October 2026");
    expect(cal.weeks.every((wk) => wk.length === 7)).toBe(true);
    expect(cal.weeks[0][0].date).toBe("2026-09-28");
    expect(cal.weeks.flat().filter((d) => d.inMonth)).toHaveLength(31);
    expect(cal.summary).toMatchObject({
      sessions: 0,
      hours: 0,
      avgStrain: null,
      busiestDay: null,
      restDays: 31,
      longestStreak: 0,
      longestRestGap: 31,
      elapsedDays: 31,
    });
    expect(day(cal, "2026-10-05").label).toBe("Mon, Oct 5: rest day");
  });

  it("current month only counts days up to today; later days are upcoming, not rest", () => {
    const cal = buildWorkoutCalendar(
      [w({ id: "a", date: "2026-11-27" })],
      "2026-11",
      "2026-11-28",
      "UTC",
    );
    expect(cal.summary.elapsedDays).toBe(28);
    expect(cal.summary.restDays).toBe(27);
    expect(cal.summary.longestRestGap).toBe(26);
    const d29 = day(cal, "2026-11-29");
    expect(d29.future).toBe(true);
    expect(d29.label).toBe("Sun, Nov 29: upcoming");
    expect(day(cal, "2026-11-28").isToday).toBe(true);
    expect(cal.nextMonth).toBeNull();
    expect(cal.prevMonth).toBe("2026-10");
  });

  it("a single workout day", () => {
    const cal = buildWorkoutCalendar(
      [w({ id: "a", date: "2026-10-14", duration_sec: 2700, strain: 14.24, sport: "Cycling" })],
      "2026-10",
      "2026-11-28",
      "UTC",
    );
    const d = day(cal, "2026-10-14");
    expect(d.totalMinutes).toBe(45);
    expect(d.band).toBe("high");
    expect(d.label).toBe("Wed, Oct 14: 1 workout, 45 min (Cycling), peak strain 14.2 (high)");
    expect(cal.summary).toMatchObject({
      sessions: 1,
      hours: 0.8,
      avgStrain: 14.2,
      busiestDay: { date: "2026-10-14", minutes: 45, sessions: 1 },
      trainingDays: 1,
      restDays: 30,
      longestStreak: 1,
      longestRestGap: 17,
    });
    expect(cal.nextMonth).toBe("2026-11");
  });

  it("multiple workouts per day: sorted by start, minutes summed, peak (not summed) strain", () => {
    const cal = buildWorkoutCalendar(
      [
        w({ id: "late", sport: "Weightlifting", start_utc: "2026-10-14T22:00:00Z", duration_sec: 1800, strain: 8 }),
        w({ id: "early", sport: "Running", start_utc: "2026-10-14T11:00:00Z", duration_sec: 3600, strain: 15 }),
        w({ id: "mid", sport: "Running", start_utc: "2026-10-14T16:00:00Z", duration_sec: 600, strain: null }),
      ],
      "2026-10",
      "2026-11-28",
      "UTC",
    );
    const d = day(cal, "2026-10-14");
    expect(d.workouts.map((x) => x.id)).toEqual(["early", "mid", "late"]);
    expect(d.workouts.map((x) => x.startTime)).toEqual(["11:00", "16:00", "22:00"]);
    expect(d.sports).toEqual(["Running", "Weightlifting"]);
    expect(d.totalMinutes).toBe(100);
    expect(d.peakStrain).toBe(15);
    expect(cal.summary.sessions).toBe(3);
    expect(cal.summary.avgStrain).toBe(11.5); // null strain excluded
  });

  it("attributes a workout crossing midnight to its local start day", () => {
    // 23:30 → 00:40 in New York (EDT, UTC-4): starts Oct 14 local.
    const cal = buildWorkoutCalendar(
      [w({ id: "x", date: "2026-10-15", start_utc: "2026-10-15T03:30:00Z", duration_sec: 4200 })],
      "2026-10",
      "2026-11-28",
      "America/New_York",
    );
    expect(day(cal, "2026-10-14").workouts.map((x) => x.id)).toEqual(["x"]);
    expect(day(cal, "2026-10-14").totalMinutes).toBe(70);
    expect(day(cal, "2026-10-15").workouts).toHaveLength(0);
    expect(day(cal, "2026-10-14").workouts[0].startTime).toBe("23:30");
  });

  it("buckets by the user's zone, not UTC (east of UTC)", () => {
    // 01:00 Oct 15 in Tokyo = 16:00 Oct 14 UTC.
    const cal = buildWorkoutCalendar(
      [w({ id: "t", date: "2026-10-14", start_utc: "2026-10-14T16:00:00Z" })],
      "2026-10",
      "2026-11-28",
      "Asia/Tokyo",
    );
    expect(day(cal, "2026-10-15").workouts).toHaveLength(1);
    expect(day(cal, "2026-10-14").workouts).toHaveLength(0);
  });

  it("DST: fall-back and spring-forward days keep one cell each and bucket correctly", () => {
    const nov = buildWorkoutCalendar(
      [
        // Nov 1 2026 01:30 EST (second 01:30, after fall-back) = 06:30Z
        w({ id: "fb", start_utc: "2026-11-01T06:30:00Z" }),
        // Nov 1 2026 23:59 EST = Nov 2 04:59Z
        w({ id: "late", start_utc: "2026-11-02T04:59:00Z" }),
      ],
      "2026-11",
      "2026-11-28",
      "America/New_York",
    );
    const dates = nov.weeks.flat().map((d) => d.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).toHaveLength(42);
    expect(day(nov, "2026-11-01").workouts.map((x) => x.id)).toEqual(["fb", "late"]);
    expect(day(nov, "2026-11-01").workouts[0].startTime).toBe("01:30");

    const mar = buildWorkoutCalendar(
      // Mar 8 2026 03:30 EDT (just after spring-forward) = 07:30Z
      [w({ id: "sf", start_utc: "2026-03-08T07:30:00Z" })],
      "2026-03",
      "2026-11-28",
      "America/New_York",
    );
    expect(day(mar, "2026-03-08").workouts[0].startTime).toBe("03:30");
    expect(mar.weeks.flat().filter((d) => d.inMonth)).toHaveLength(31);
  });

  it("falls back to the stored date when start_utc is missing or invalid, and on a bad tz", () => {
    const cal = buildWorkoutCalendar(
      [
        w({ id: "a", date: "2026-10-03", start_utc: null }),
        w({ id: "b", date: "2026-10-04", start_utc: "not-a-date" }),
      ],
      "2026-10",
      "2026-11-28",
      "Not/AZone",
    );
    expect(day(cal, "2026-10-03").workouts[0].startTime).toBeNull();
    expect(day(cal, "2026-10-04").workouts).toHaveLength(1);
    const utc = buildWorkoutCalendar([w({ id: "c", start_utc: "2026-10-14T23:30:00Z" })], "2026-10", "2026-11-28", "Bad/Zone");
    expect(day(utc, "2026-10-14").workouts).toHaveLength(1);
  });

  it("nulls: missing sport, duration and strain", () => {
    const cal = buildWorkoutCalendar(
      [w({ id: "n", date: "2026-10-09", sport: null, duration_sec: null, strain: null })],
      "2026-10",
      "2026-11-28",
      "UTC",
    );
    const d = day(cal, "2026-10-09");
    expect(d.sports).toEqual(["Unknown"]);
    expect(d.totalMinutes).toBe(0);
    expect(d.band).toBeNull();
    expect(d.label).toBe("Fri, Oct 9: 1 workout, 0 min (Unknown)");
    expect(cal.summary.avgStrain).toBeNull();
    expect(cal.summary.trainingDays).toBe(1);
  });

  it("leading/trailing grid days show workouts but don't count toward the month", () => {
    const cal = buildWorkoutCalendar(
      [w({ id: "lead", date: "2026-09-30" }), w({ id: "trail", date: "2026-11-01" }), w({ id: "out", date: "2026-09-01" })],
      "2026-10",
      "2026-11-28",
      "UTC",
    );
    expect(day(cal, "2026-09-30").inMonth).toBe(false);
    expect(day(cal, "2026-09-30").workouts).toHaveLength(1);
    expect(day(cal, "2026-11-01").workouts).toHaveLength(1);
    expect(cal.weeks.flat().some((d) => d.date === "2026-09-01")).toBe(false);
    expect(cal.summary.sessions).toBe(0);
  });

  it("streaks and gaps across the month, busiest-day tie-break", () => {
    const rows = ["01", "02", "03", "07", "08", "20"].map((d, i) =>
      w({ id: `r${i}`, date: `2026-10-${d}`, duration_sec: 1800 }),
    );
    rows.push(w({ id: "dup-day", date: "2026-10-08", duration_sec: 0 }));
    const cal = buildWorkoutCalendar(rows, "2026-10", "2026-11-28", "UTC");
    expect(cal.summary.longestStreak).toBe(3);
    expect(cal.summary.longestRestGap).toBe(11); // Oct 21..31
    expect(cal.summary.trainingDays).toBe(6);
    expect(cal.summary.restDays).toBe(25);
    // All 30 min; Oct 8 wins on session count.
    expect(cal.summary.busiestDay).toEqual({ date: "2026-10-08", minutes: 30, sessions: 2 });
  });

  it("dedupes repeated ids", () => {
    const cal = buildWorkoutCalendar([w({ id: "a" }), w({ id: "a" })], "2026-11", "2026-11-28", "UTC");
    expect(cal.summary.sessions).toBe(1);
  });

  it("no prev link before MIN_MONTH", () => {
    expect(buildWorkoutCalendar([], "2012-01", "2026-11-28", "UTC").prevMonth).toBeNull();
    expect(buildWorkoutCalendar([], "2026-01", "2026-11-28", "UTC").prevMonth).toBe("2025-12");
  });
});
