import { describe, expect, it } from "vitest";
import type { SleepRow } from "@/lib/db/sleep";
import {
  MIN_NIGHTS,
  computeSleepRegularity,
  computeSri,
  formatClock,
  formatMinutes,
  parseRegularityWindow,
  pickTip,
  rateRegularity,
  shiftDate,
  toNights,
} from "./sleepRegularity";

const TODAY = "2026-11-27"; // a Friday

function row(date: string, start: string | null, end: string | null): SleepRow {
  return {
    date,
    in_bed_ms: null,
    light_ms: null,
    deep_ms: null,
    rem_ms: null,
    awake_ms: null,
    sleep_need_ms: null,
    performance: null,
    efficiency: null,
    consistency: null,
    disturbances: null,
    cycles: null,
    respiratory_rate: null,
    need_from_baseline_ms: null,
    need_from_debt_ms: null,
    need_from_strain_ms: null,
    need_from_nap_ms: null,
    start_local: start,
    end_local: end,
  };
}

/** A night going to bed at `bed` (HH:MM, evening of the previous day when
 *  >= 12:00, else the wake day itself) and waking at `wake` on `date`. */
function night(date: string, bed: string, wake: string): SleepRow {
  const bedDay = Number(bed.slice(0, 2)) >= 12 ? shiftDate(date, -1) : date;
  return row(date, `${bedDay}T${bed}:00`, `${date}T${wake}:00`);
}

/** `n` consecutive nights ending at `end`, all with the same schedule. */
function nights(end: string, n: number, bed: string, wake: string): SleepRow[] {
  return Array.from({ length: n }, (_, i) => night(shiftDate(end, -(n - 1 - i)), bed, wake));
}

describe("parseRegularityWindow", () => {
  it("accepts 14 and defaults everything else to 30", () => {
    expect(parseRegularityWindow("14")).toBe(14);
    expect(parseRegularityWindow("30")).toBe(30);
    expect(parseRegularityWindow(undefined)).toBe(30);
    expect(parseRegularityWindow("7")).toBe(30);
    expect(parseRegularityWindow("abc")).toBe(30);
  });
});

describe("toNights", () => {
  it("skips null / malformed local times and implausible spans", () => {
    const out = toNights(
      [
        row("2026-11-20", null, "2026-11-20T07:00:00"),
        row("2026-11-21", "2026-11-20T23:00:00", null),
        row("2026-11-22", "garbage", "2026-11-22T07:00:00"),
        row("2026-11-23", "2026-11-23T07:00:00", "2026-11-23T07:00:00"), // zero length
        row("2026-11-24", "2026-11-22T23:00:00", "2026-11-24T07:00:00"), // 32h
        night("2026-11-25", "23:00", "07:00"),
      ],
      "2026-11-01",
      TODAY,
    );
    expect(out.map((n) => n.date)).toEqual(["2026-11-25"]);
    expect(out[0].hours).toBe(8);
  });

  it("filters to the window by wake day and sorts oldest first", () => {
    const out = toNights(
      [night("2026-11-27", "23:00", "07:00"), night("2026-11-12", "23:00", "07:00"), night("2026-11-14", "23:00", "07:00")],
      "2026-11-14",
      TODAY,
    );
    expect(out.map((n) => n.date)).toEqual(["2026-11-14", "2026-11-27"]);
  });

  it("keeps the longest night if a caller passes two rows for one wake day", () => {
    const out = toNights(
      [night("2026-11-25", "23:00", "03:00"), night("2026-11-25", "22:00", "07:00")],
      "2026-11-01",
      TODAY,
    );
    expect(out).toHaveLength(1);
    expect(out[0].hours).toBe(9);
  });

  it("treats a bedtime after midnight as the same night, not a day later", () => {
    const [a] = toNights([night("2026-11-25", "00:30", "08:00")], "2026-11-01", TODAY);
    expect(a.bedDate).toBe("2026-11-25");
    expect(a.bedFromAnchor).toBeCloseTo(4.5); // 4.5h after 20:00
    expect(a.hours).toBeCloseTo(7.5);
  });

  it("flags Sat/Sun wake days as weekend nights", () => {
    const out = toNights(
      [night("2026-11-27", "23:00", "07:00"), night("2026-11-28", "23:00", "07:00"), night("2026-11-29", "23:00", "07:00")],
      "2026-11-01",
      "2026-11-30",
    );
    expect(out.map((n) => n.weekend)).toEqual([false, true, true]);
  });
});

describe("computeSri", () => {
  it("is 100 for an identical schedule every night", () => {
    const n = toNights(nights(TODAY, 14, "23:00", "07:00"), shiftDate(TODAY, -13), TODAY);
    const r = computeSri(n, shiftDate(TODAY, -13), TODAY);
    expect(r.pairs).toBe(13);
    expect(r.sri).toBeCloseTo(100);
    expect(r.matchPct).toBeCloseTo(100);
  });

  it("matches the hand-computed value for a 4h alternating shift", () => {
    // Nights alternate 23:00–07:00 and 03:00–11:00: 8 of every 24 clock
    // hours differ → P(match) = 2/3 → SRI = 200·2/3 − 100 = 33.3.
    const start = shiftDate(TODAY, -13);
    const rows = Array.from({ length: 14 }, (_, i) => {
      const d = shiftDate(start, i);
      return i % 2 ? night(d, "03:00", "11:00") : night(d, "23:00", "07:00");
    });
    const r = computeSri(toNights(rows, start, TODAY), start, TODAY);
    expect(r.matchPct).toBeCloseTo(66.667, 2);
    expect(r.sri).toBeCloseTo(33.333, 2);
  });

  it("skips gaps instead of scoring a missing night as awake", () => {
    // Every other night missing: no consecutive pairs → no SRI.
    const start = shiftDate(TODAY, -29);
    const rows = Array.from({ length: 15 }, (_, i) => night(shiftDate(start, i * 2), "23:00", "07:00"));
    const r = computeSri(toNights(rows, start, TODAY), start, TODAY);
    expect(r.pairs).toBe(0);
    expect(r.sri).toBeNull();
  });

  it("counts only the pairs around a gap and still scores 100 on a steady schedule", () => {
    const start = shiftDate(TODAY, -13);
    const rows = nights(TODAY, 14, "23:00", "07:00").filter((r) => r.date !== shiftDate(TODAY, -6));
    const r = computeSri(toNights(rows, start, TODAY), start, TODAY);
    expect(r.pairs).toBe(11); // 13 pairs minus the two touching the gap
    expect(r.sri).toBeCloseTo(100);
  });

  it("returns null with fewer than 5 consecutive pairs", () => {
    const start = shiftDate(TODAY, -13);
    const r = computeSri(toNights(nights(TODAY, 4, "23:00", "07:00"), start, TODAY), start, TODAY);
    expect(r.pairs).toBe(3);
    expect(r.sri).toBeNull();
  });

  it("is unaffected by the US fall-back DST night when clock times are steady", () => {
    // DST ended 2026-11-01 02:00 local. Whoop stores wall-clock local times,
    // so 23:00 EDT → 07:00 EST is the same clock schedule as every other night.
    const end = "2026-11-08";
    const start = shiftDate(end, -13);
    const r = computeSri(toNights(nights(end, 14, "23:00", "07:00"), start, end), start, end);
    expect(r.sri).toBeCloseTo(100);
  });

  it("is unaffected by the spring-forward DST night too", () => {
    const end = "2026-03-15";
    const start = shiftDate(end, -13);
    const r = computeSri(toNights(nights(end, 14, "22:30", "06:30"), start, end), start, end);
    expect(r.sri).toBeCloseTo(100);
  });
});

describe("computeSleepRegularity", () => {
  it("empty data → not enough data", () => {
    const r = computeSleepRegularity([], TODAY, 30);
    expect(r.status).toBe("insufficient");
    expect(r.nights).toHaveLength(0);
    expect(r.start).toBe("2026-10-29");
  });

  it("one night → not enough data", () => {
    const r = computeSleepRegularity([night(TODAY, "23:00", "07:00")], TODAY, 14);
    expect(r.status).toBe("insufficient");
    expect(r.nights).toHaveLength(1);
  });

  it(`needs ${MIN_NIGHTS} nights: 6 is insufficient, 7 is ok`, () => {
    expect(computeSleepRegularity(nights(TODAY, 6, "23:00", "07:00"), TODAY, 14).status).toBe("insufficient");
    expect(computeSleepRegularity(nights(TODAY, 7, "23:00", "07:00"), TODAY, 14).status).toBe("ok");
  });

  it("ignores nights older than the selected window", () => {
    const rows = nights(TODAY, 30, "23:00", "07:00");
    const r = computeSleepRegularity(rows, TODAY, 14);
    expect(r.nights).toHaveLength(14);
    expect(r.start).toBe("2026-11-14");
  });

  it("steady schedule → very regular, zero spread, steady tip", () => {
    const r = computeSleepRegularity(nights(TODAY, 14, "23:00", "07:00"), TODAY, 14);
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.sri).toBeCloseTo(100);
    expect(r.rating).toEqual({ label: "Very regular", tone: "good", basis: "sri" });
    expect(r.bedtime.median).toBeCloseTo(23);
    expect(r.bedtime.sdMin).toBeCloseTo(0);
    expect(r.wake.median).toBeCloseTo(7);
    expect(r.tip).toContain("steady");
    expect(r.tip).toContain("11:00pm");
  });

  it("bedtimes either side of midnight have a small spread, not ~23h", () => {
    const start = shiftDate(TODAY, -9);
    const rows = Array.from({ length: 10 }, (_, i) =>
      night(shiftDate(start, i), i % 2 ? "00:30" : "23:30", "07:30"),
    );
    const r = computeSleepRegularity(rows, TODAY, 14);
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.bedtime.sdMin).toBeCloseTo(30);
    expect(r.bedtime.median).toBeCloseTo(0); // midnight
    expect(r.bedtime.earliest.hour).toBeCloseTo(23.5);
    expect(r.bedtime.latest.hour).toBeCloseTo(0.5);
    expect(formatClock(r.bedtime.median)).toBe("12:00am");
  });

  it("reports earliest/latest with the night's date", () => {
    const rows = nights(TODAY, 10, "23:00", "07:00");
    rows[2] = night(rows[2].date, "21:15", "06:00");
    rows[5] = night(rows[5].date, "01:45", "09:20");
    const r = computeSleepRegularity(rows, TODAY, 14);
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.bedtime.earliest).toEqual({ hour: 21.25, date: rows[2].date });
    expect(r.bedtime.latest.date).toBe(rows[5].date);
    expect(r.bedtime.latest.hour).toBeCloseTo(1.75);
    expect(r.wake.earliest).toEqual({ hour: 6, date: rows[2].date });
    expect(r.wake.latest.date).toBe(rows[5].date);
  });

  it("measures social jetlag from mid-sleep (weekend later = positive) and tips on it", () => {
    const rows = Array.from({ length: 28 }, (_, i) => {
      const d = shiftDate(TODAY, -27 + i);
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      return dow === 0 || dow === 6 ? night(d, "01:00", "10:00") : night(d, "23:00", "07:00");
    });
    const r = computeSleepRegularity(rows, TODAY, 30);
    if (r.status !== "ok") throw new Error("expected ok");
    // weekday mid 03:00, weekend mid 05:30 → +150 min
    expect(r.socialJetlag!.minutes).toBeCloseTo(150);
    expect(r.socialJetlag!.weekdayMid).toBeCloseTo(3);
    expect(r.socialJetlag!.weekendMid).toBeCloseTo(5.5);
    expect(r.socialJetlag!.weekendNights).toBe(8);
    expect(r.socialJetlag!.weekdayNights).toBe(20);
    expect(r.tip).toContain("2h 30m later");
  });

  it("no weekend nights → social jetlag null", () => {
    // Mon Nov 23 – Fri Nov 27 + Mon–Tue before: weekdays only.
    const days = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25"];
    const r = computeSleepRegularity(days.map((d) => night(d, "23:00", "07:00")), TODAY, 14);
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.socialJetlag).toBeNull();
  });

  it("gappy data with enough nights falls back to a timing-based rating", () => {
    const start = shiftDate(TODAY, -29);
    const rows = Array.from({ length: 15 }, (_, i) => night(shiftDate(start, i * 2), "23:00", "07:00"));
    const r = computeSleepRegularity(rows, TODAY, 30);
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.sri).toBeNull();
    expect(r.rating.basis).toBe("timing");
    expect(r.rating.label).toBe("Very regular");
  });
});

describe("rateRegularity", () => {
  it("uses SRI thresholds when available", () => {
    expect(rateRegularity(85, 0, 0).label).toBe("Very regular");
    expect(rateRegularity(75, 0, 0).label).toBe("Regular");
    expect(rateRegularity(65, 0, 0).label).toBe("Somewhat irregular");
    expect(rateRegularity(20, 0, 0)).toEqual({ label: "Irregular", tone: "bad", basis: "sri" });
  });
  it("falls back to the worse of bed/wake SD", () => {
    expect(rateRegularity(null, 20, 40).label).toBe("Regular");
    expect(rateRegularity(null, 90, 10).label).toBe("Irregular");
  });
});

describe("pickTip", () => {
  const stats = (median: number, sdMin: number) => ({
    median,
    sdMin,
    earliest: { hour: median, date: TODAY },
    latest: { hour: median, date: TODAY },
  });
  it("targets wake time when it is the most variable", () => {
    const tip = pickTip(stats(23, 20), stats(7, 70), null);
    expect(tip).toContain("wake time varies by about 1h 10m");
    expect(tip).toContain("7:00am");
  });
  it("targets bedtime with a wind-down 30 min before the median", () => {
    const tip = pickTip(stats(23, 60), stats(7, 20), null);
    expect(tip).toContain("bedtime varies by about 1h");
    expect(tip).toContain("10:30pm");
  });
  it("handles a wind-down that crosses midnight backwards", () => {
    const tip = pickTip(stats(0.25, 60), stats(7, 20), null);
    expect(tip).toContain("11:45pm");
  });
  it("handles weekend-earlier social jetlag", () => {
    const tip = pickTip(stats(23, 10), stats(7, 10), {
      minutes: -75,
      weekdayMid: 3,
      weekendMid: 1.75,
      weekdayNights: 5,
      weekendNights: 2,
    });
    expect(tip).toContain("1h 15m earlier");
  });
});

describe("formatters", () => {
  it("formatClock wraps and rounds", () => {
    expect(formatClock(23.5)).toBe("11:30pm");
    expect(formatClock(24.25)).toBe("12:15am");
    expect(formatClock(-0.5)).toBe("11:30pm");
    expect(formatClock(12)).toBe("12:00pm");
    expect(formatClock(6.999)).toBe("7:00am");
  });
  it("formatMinutes", () => {
    expect(formatMinutes(42.4)).toBe("42 min");
    expect(formatMinutes(-60)).toBe("1h");
    expect(formatMinutes(150)).toBe("2h 30m");
  });
});
