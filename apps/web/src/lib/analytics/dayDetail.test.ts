import { describe, expect, it } from "vitest";
import {
  PICKER_MAX_DATES,
  addDays,
  buildDayDetail,
  clockFromLocalIso,
  clockInTz,
  formatDayLong,
  formatHm,
  parseDayParam,
  recoveryBand,
  todayInTz,
  validateDayParam,
  type DayDetailInput,
  type DaySleepInput,
  type DayWorkoutInput,
} from "./dayDetail";

const TODAY = "2026-11-28";

function input(over: Partial<DayDetailInput> = {}): DayDetailInput {
  return {
    date: "2026-11-20",
    today: TODAY,
    tz: "America/New_York",
    recovery: null,
    sleep: null,
    naps: [],
    cycle: null,
    workouts: [],
    journal: [],
    datesWithData: [],
    ...over,
  };
}

function sleepRow(over: Partial<DaySleepInput> = {}): DaySleepInput {
  return {
    date: "2026-11-20",
    in_bed_ms: 8 * 3_600_000,
    light_ms: 4 * 3_600_000,
    deep_ms: 1.5 * 3_600_000,
    rem_ms: 1.5 * 3_600_000,
    awake_ms: 1 * 3_600_000,
    sleep_need_ms: 8 * 3_600_000,
    performance: 88,
    efficiency: 91,
    consistency: 75,
    disturbances: 6,
    respiratory_rate: 14.6,
    start_local: "2026-11-19T23:11:00",
    end_local: "2026-11-20T07:11:00",
    ...over,
  };
}

function workout(over: Partial<DayWorkoutInput> = {}): DayWorkoutInput {
  return {
    id: "w1",
    date: "2026-11-20",
    sport: "Running",
    duration_sec: 2700,
    avg_hr: 151,
    max_hr: 178,
    strain: 11.2,
    kilojoule: 2000,
    distance_m: 8200,
    start_utc: "2026-11-20T11:42:00.000Z",
    ...over,
  };
}

describe("parseDayParam / validateDayParam", () => {
  it.each([
    "2026-02-30",
    "2026-13-01",
    "2026-00-10",
    "2026-04-31",
    "2025-02-29", // not a leap year
    "2026-1-5",
    "20261105",
    "2026-11-05 ",
    " 2026-11-05",
    "2026-11-05T00:00",
    "abcd-ef-gh",
    "",
    "1899-12-31",
    "../2026-11-05",
  ])("rejects %j", (raw) => {
    expect(parseDayParam(raw)).toBeNull();
    expect(validateDayParam(raw, TODAY)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects non-strings", () => {
    expect(parseDayParam(undefined)).toBeNull();
    expect(parseDayParam(["2026-11-05"])).toBeNull();
    expect(parseDayParam(20261105)).toBeNull();
  });

  it("accepts real dates including leap day", () => {
    expect(parseDayParam("2024-02-29")).toBe("2024-02-29");
    expect(parseDayParam("2026-12-31")).toBe("2026-12-31");
  });

  it("accepts today, rejects tomorrow as future", () => {
    expect(validateDayParam(TODAY, TODAY)).toEqual({ ok: true, date: TODAY });
    expect(validateDayParam("2026-11-29", TODAY)).toEqual({ ok: false, reason: "future" });
    expect(validateDayParam("2027-01-01", TODAY)).toEqual({ ok: false, reason: "future" });
  });
});

describe("date math across DST and boundaries", () => {
  it("addDays steps whole calendar days across DST transitions", () => {
    // US DST start 2026-03-08, end 2026-11-01; EU end 2026-10-25.
    expect(addDays("2026-03-08", -1)).toBe("2026-03-07");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-10-25", -1)).toBe("2026-10-24");
  });

  it("addDays crosses month, year and leap boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("todayInTz uses the user's zone, not UTC", () => {
    // 03:30Z on Nov 28 is still Nov 27 evening in New York, Nov 28 in Tokyo.
    const now = new Date("2026-11-28T03:30:00Z");
    expect(todayInTz(now, "America/New_York")).toBe("2026-11-27");
    expect(todayInTz(now, "Asia/Tokyo")).toBe("2026-11-28");
    expect(todayInTz(now, "UTC")).toBe("2026-11-28");
  });

  it("todayInTz falls back to UTC for an unknown zone", () => {
    expect(todayInTz(new Date("2026-11-28T03:30:00Z"), "Not/AZone")).toBe("2026-11-28");
  });

  it("clockInTz applies the correct offset on each side of a DST change", () => {
    // 07:30Z: EST (-5) before Mar 8 → 2:30 AM; EDT (-4) after → 3:30 AM.
    expect(clockInTz("2026-03-07T07:30:00Z", "America/New_York")).toBe("2:30 AM");
    expect(clockInTz("2026-03-09T07:30:00Z", "America/New_York")).toBe("3:30 AM");
    expect(clockInTz("2026-11-02T12:00:00Z", "America/New_York")).toBe("7:00 AM");
    expect(clockInTz("garbage", "America/New_York")).toBeNull();
    expect(clockInTz(null, "UTC")).toBeNull();
  });

  it("clockFromLocalIso reads the stored local wall clock verbatim", () => {
    expect(clockFromLocalIso("2026-11-19T23:11:00")).toBe("11:11 PM");
    expect(clockFromLocalIso("2026-11-20T00:05:00")).toBe("12:05 AM");
    expect(clockFromLocalIso("2026-11-20T12:00:00")).toBe("12:00 PM");
    expect(clockFromLocalIso(null)).toBeNull();
    expect(clockFromLocalIso("nope")).toBeNull();
  });

  it("formatDayLong never shifts the calendar day", () => {
    expect(formatDayLong("2026-03-08")).toBe("Sunday, Mar 8, 2026");
    expect(formatDayLong("2026-01-01")).toBe("Thursday, Jan 1, 2026");
  });
});

describe("small formatters", () => {
  it("formatHm", () => {
    expect(formatHm(0)).toBe("0m");
    expect(formatHm(42 * 60_000)).toBe("42m");
    expect(formatHm(7 * 3_600_000 + 5 * 60_000)).toBe("7h 05m");
    expect(formatHm(-5)).toBe("0m");
  });

  it("recoveryBand uses Whoop's 67 / 34 cut-offs", () => {
    expect(recoveryBand(100)).toBe("green");
    expect(recoveryBand(67)).toBe("green");
    expect(recoveryBand(66)).toBe("yellow");
    expect(recoveryBand(34)).toBe("yellow");
    expect(recoveryBand(33)).toBe("red");
    expect(recoveryBand(0)).toBe("red");
  });
});

describe("buildDayDetail", () => {
  it("empty day: no sections, graceful recap, nav still works", () => {
    const d = buildDayDetail(input());
    expect(d.hasAnyData).toBe(false);
    expect(d.recovery).toBeNull();
    expect(d.sleep).toBeNull();
    expect(d.strain).toBeNull();
    expect(d.workouts).toEqual([]);
    expect(d.recap).toBe("No data was recorded for this day.");
    expect(d.prevDate).toBe("2026-11-19");
    expect(d.nextDate).toBe("2026-11-21");
    expect(d.pickerDates).toEqual([]);
    expect(d.prevWithData).toBeNull();
    expect(d.nextWithData).toBeNull();
  });

  it("empty today says nothing has synced yet and has no next day", () => {
    const d = buildDayDetail(input({ date: TODAY }));
    expect(d.isToday).toBe(true);
    expect(d.nextDate).toBeNull();
    expect(d.recap).toBe("Nothing has synced for today yet.");
  });

  it("full day: every section populated and a one-line recap", () => {
    const d = buildDayDetail(
      input({
        recovery: { date: "2026-11-20", recovery_score: 72, hrv: 61.4, rhr: 52, spo2: 96.5, skin_temp: 33.4 },
        sleep: sleepRow(),
        cycle: { date: "2026-11-20", strain: 14.23, kilojoule: 10_000, avg_hr: 72, max_hr: 178 },
        workouts: [workout()],
        journal: [{ date: "2026-11-20", title: "Long run", content: "Felt good", mood: "great", tags: '["run","outdoor"]' }],
        datesWithData: ["2026-11-19", "2026-11-20", "2026-11-21"],
      }),
    );
    expect(d.hasAnyData).toBe(true);
    expect(d.recovery).toMatchObject({ score: 72, band: "green", hrv: 61.4, rhr: 52, respiratoryRate: 14.6, skinTemp: 33.4 });
    expect(d.sleep?.asleepMs).toBe(7 * 3_600_000);
    expect(d.sleep?.bedtime).toBe("11:11 PM");
    expect(d.sleep?.wake).toBe("7:11 AM");
    expect(d.sleep?.stages.map((s) => s.key)).toEqual(["deep", "rem", "light", "awake"]);
    expect(d.sleep?.stages.reduce((a, s) => a + s.pct, 0)).toBeCloseTo(100);
    expect(d.strain).toEqual({ strain: 14.23, kcal: 2390, avgHr: 72, maxHr: 178 });
    expect(d.workouts[0]).toMatchObject({ sport: "Running", startTime: "6:42 AM", kcal: 478, distanceKm: 8.2 });
    expect(d.journal[0].tags).toEqual(["run", "outdoor"]);
    expect(d.recap).toBe(
      "Green recovery at 72%, 7h 00m asleep (88% sleep performance), day strain 14.2, 1 workout (Running), 1 journal entry.",
    );
    expect(d.prevWithData).toBe("2026-11-19");
    expect(d.nextWithData).toBe("2026-11-21");
  });

  it("missing sections: only strain present", () => {
    const d = buildDayDetail(
      input({ cycle: { date: "2026-11-20", strain: 6.1, kilojoule: null, avg_hr: null, max_hr: null } }),
    );
    expect(d.recovery).toBeNull();
    expect(d.sleep).toBeNull();
    expect(d.strain).toEqual({ strain: 6.1, kcal: null, avgHr: null, maxHr: null });
    expect(d.recap).toBe("Day strain 6.1, no workouts.");
  });

  it("all-null rows collapse to absent sections", () => {
    const d = buildDayDetail(
      input({
        recovery: { date: "2026-11-20", recovery_score: null, hrv: null, rhr: null, spo2: null, skin_temp: null },
        sleep: sleepRow({
          in_bed_ms: null, light_ms: null, deep_ms: null, rem_ms: null, awake_ms: null, performance: null,
          efficiency: null, respiratory_rate: null, start_local: null, end_local: null,
        }),
        cycle: { date: "2026-11-20", strain: null, kilojoule: null, avg_hr: null, max_hr: null },
      }),
    );
    expect(d.recovery).toBeNull();
    expect(d.sleep).toBeNull();
    expect(d.strain).toBeNull();
    expect(d.hasAnyData).toBe(false);
  });

  it("partial recovery (HRV only) and nap-only sleep", () => {
    const d = buildDayDetail(
      input({
        recovery: { date: "2026-11-20", recovery_score: null, hrv: 40, rhr: null, spo2: null, skin_temp: null },
        naps: [{ date: "2026-11-20", duration_ms: 20 * 60_000 }, { date: "2026-11-20", duration_ms: null }],
      }),
    );
    expect(d.recovery?.band).toBeNull();
    expect(d.naps).toEqual({ count: 2, totalMs: 20 * 60_000 });
    expect(d.recap).toBe("HRV 40 ms, 2 naps (20m).");
  });

  it("today's recap is prefixed and red band is lower-case mid-sentence", () => {
    const d = buildDayDetail(
      input({ date: TODAY, recovery: { date: TODAY, recovery_score: 21, hrv: 30, rhr: 60, spo2: null, skin_temp: null } }),
    );
    expect(d.recap).toBe("So far today: red recovery at 21%.");
  });

  it("workouts are ordered by start time, de-duplicates sports in the recap, defaults a missing sport", () => {
    const d = buildDayDetail(
      input({
        workouts: [
          workout({ id: "b", start_utc: "2026-11-20T22:00:00Z", sport: "Running" }),
          workout({ id: "a", start_utc: "2026-11-20T12:00:00Z", sport: "Cycling" }),
          workout({ id: "c", start_utc: null, sport: "  ", distance_m: 0, kilojoule: null }),
        ],
      }),
    );
    expect(d.workouts.map((w) => w.id)).toEqual(["c", "a", "b"]);
    expect(d.workouts[0]).toMatchObject({ sport: "Workout", startTime: null, distanceKm: null, kcal: null });
    expect(d.recap).toBe("3 workouts (Workout, Cycling and Running).");
  });

  it("drops blank journal rows and splits comma tags", () => {
    const d = buildDayDetail(
      input({
        journal: [
          { date: "2026-11-20", title: " ", content: "", mood: null, tags: null },
          { date: "2026-11-20", title: null, content: "note", mood: null, tags: "a, b,,c" },
        ],
      }),
    );
    expect(d.journal).toEqual([{ title: null, content: "note", mood: null, tags: ["a", "b", "c"] }]);
  });

  it("picker: newest first, de-duplicated, excludes future and malformed dates", () => {
    const d = buildDayDetail(
      input({
        datesWithData: ["2026-11-01", "2026-11-29", "bad", "2026-11-25", "2026-11-01", TODAY],
      }),
    );
    expect(d.pickerDates).toEqual([TODAY, "2026-11-25", "2026-11-01"]);
    // Gap navigation from an empty day.
    expect(d.prevWithData).toBe("2026-11-01");
    expect(d.nextWithData).toBe("2026-11-25");
  });

  it("picker is capped but always contains the viewed day when it has data", () => {
    const dates = Array.from({ length: 500 }, (_, i) => addDays(TODAY, -i));
    const old = addDays(TODAY, -450);
    const d = buildDayDetail(
      input({ date: old, datesWithData: dates, cycle: { date: old, strain: 5, kilojoule: null, avg_hr: null, max_hr: null } }),
    );
    expect(d.pickerDates.length).toBe(PICKER_MAX_DATES + 1);
    expect(d.pickerDates[0]).toBe(TODAY);
    expect(d.pickerDates.at(-1)).toBe(old);
  });

  it("a day with data missing from daily_summary still lands in the picker", () => {
    const d = buildDayDetail(input({ workouts: [workout()], datesWithData: ["2026-11-01"] }));
    expect(d.pickerDates).toEqual(["2026-11-20", "2026-11-01"]);
  });

  it("first data day has no earlier neighbour; single-day dataset", () => {
    const d = buildDayDetail(input({ workouts: [workout()], datesWithData: ["2026-11-20"] }));
    expect(d.prevWithData).toBeNull();
    expect(d.nextWithData).toBeNull();
    expect(d.pickerDates).toEqual(["2026-11-20"]);
  });
});
