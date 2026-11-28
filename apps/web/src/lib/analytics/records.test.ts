import { describe, expect, it } from "vitest";
import {
  bestPerDay,
  buildRecordBoard,
  buildRecordHistory,
  dayNumber,
  RECORD_METRICS,
  type MetricPoint,
  type RecordSeries,
} from "./records";

const T = "2026-11-27";
const pts = (pairs: [string, number | null][]): MetricPoint[] =>
  pairs.map(([date, value]) => ({ date, value }));

describe("dayNumber", () => {
  it("parses calendar dates and rejects junk or rollovers", () => {
    expect(dayNumber("1970-01-02")).toBe(1);
    expect(dayNumber("2026-02-30")).toBeNull();
    expect(dayNumber("2026-1-5")).toBeNull();
    expect(dayNumber("2026-11-27T00:00:00Z")).toBeNull();
    expect(dayNumber("")).toBeNull();
  });

  it("counts DST-transition days as exactly one day (US + EU 2026)", () => {
    expect(dayNumber("2026-03-09")! - dayNumber("2026-03-08")!).toBe(1);
    expect(dayNumber("2026-11-02")! - dayNumber("2026-11-01")!).toBe(1);
    expect(dayNumber("2026-03-30")! - dayNumber("2026-03-29")!).toBe(1);
    expect(dayNumber("2026-10-26")! - dayNumber("2026-10-25")!).toBe(1);
  });

  it("handles leap days and year boundaries", () => {
    expect(dayNumber("2028-02-29")).not.toBeNull();
    expect(dayNumber("2027-02-29")).toBeNull();
    expect(dayNumber("2027-01-01")! - dayNumber("2026-12-31")!).toBe(1);
  });
});

describe("buildRecordHistory", () => {
  it("empty input → no record, nothing to compare", () => {
    const h = buildRecordHistory([], "max", { today: T });
    expect(h).toMatchObject({
      current: null, previous: [], recordCount: 0, daysSinceRecord: null,
      typical: null, typicalSamples: 0, deltaVsTypical: null, days: 0,
      firstDate: null, lastDate: null,
    });
  });

  it("all-null / non-finite / bad-date input behaves like empty", () => {
    const h = buildRecordHistory(
      [{ date: T, value: null }, { date: T, value: Number.NaN }, { date: "nope", value: 5 }, { date: T, value: undefined }],
      "max",
      { today: T },
    );
    expect(h.current).toBeNull();
    expect(h.days).toBe(0);
  });

  it("first-day user: one record, set today, typical = itself", () => {
    const h = buildRecordHistory(pts([[T, 62]]), "max", { today: T });
    expect(h.current).toMatchObject({ value: 62, setOn: T, lastMatchedOn: T, ties: 0 });
    expect(h.previous).toEqual([]);
    expect(h.recordCount).toBe(1);
    expect(h.daysSinceRecord).toBe(0);
    expect(h.typical).toBe(62);
    expect(h.deltaVsTypical).toBe(0);
    expect(h.deltaPctVsTypical).toBe(0);
  });

  it("tracks progression newest-first and caps it at 3", () => {
    const h = buildRecordHistory(
      pts([
        ["2026-01-01", 50], ["2026-01-02", 55], ["2026-01-03", 52],
        ["2026-02-01", 60], ["2026-03-01", 70], ["2026-04-01", 65], ["2026-05-01", 80],
      ]),
      "max",
      { today: T },
    );
    expect(h.current?.value).toBe(80);
    expect(h.current?.setOn).toBe("2026-05-01");
    expect(h.previous.map((p) => [p.value, p.setOn])).toEqual([
      [70, "2026-03-01"], [60, "2026-02-01"], [55, "2026-01-02"],
    ]);
    expect(h.recordCount).toBe(5);
    expect(h.daysSinceRecord).toBe(dayNumber(T)! - dayNumber("2026-05-01")!);
  });

  it("min direction: lower is a record", () => {
    const h = buildRecordHistory(pts([["2026-11-01", 55], ["2026-11-02", 52], ["2026-11-03", 58], ["2026-11-04", 49]]), "min", { today: T });
    expect(h.current?.value).toBe(49);
    expect(h.previous.map((p) => p.value)).toEqual([52, 55]);
  });

  it("ties don't set a new record but move lastMatchedOn and days-since", () => {
    const h = buildRecordHistory(pts([["2026-11-01", 90], ["2026-11-10", 90], ["2026-11-20", 90], ["2026-11-21", 70]]), "max", { today: T });
    expect(h.current).toMatchObject({ value: 90, setOn: "2026-11-01", lastMatchedOn: "2026-11-20", ties: 2 });
    expect(h.previous).toEqual([]);
    expect(h.recordCount).toBe(1);
    expect(h.daysSinceRecord).toBe(7);
  });

  it("same-date readings collapse to that day's best (and its note)", () => {
    const input: MetricPoint[] = [
      { date: "2026-11-02", value: 1800, note: "Running" },
      { date: "2026-11-02", value: 5400, note: "Cycling" },
      { date: "2026-11-02", value: 600, note: "Yoga" },
    ];
    expect(bestPerDay(input, "max")).toEqual([{ date: "2026-11-02", day: dayNumber("2026-11-02"), value: 5400, note: "Cycling" }]);
    const h = buildRecordHistory(input, "max", { today: T });
    expect(h.days).toBe(1);
    expect(h.current).toMatchObject({ value: 5400, note: "Cycling", ties: 0 });
  });

  it("unsorted input with gaps is ordered by date before walking", () => {
    const h = buildRecordHistory(pts([["2026-06-01", 70], ["2025-01-01", 40], ["2025-09-15", 60]]), "max", { today: T });
    expect(h.previous.map((p) => p.setOn)).toEqual(["2025-09-15", "2025-01-01"]);
    expect(h.firstDate).toBe("2025-01-01");
    expect(h.lastDate).toBe("2026-06-01");
  });

  it("typical = median of the trailing 90 days (inclusive of today, exclusive of day -90)", () => {
    const today = dayNumber(T)!;
    const iso = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
    const h = buildRecordHistory(
      pts([
        [iso(today - 400), 200], // old all-time record, outside the window
        [iso(today - 90), 1000], // exactly 90 days back: outside the 90-day window
        [iso(today - 89), 10], [iso(today - 30), 20], [iso(today - 1), 30], [iso(today), 40],
      ]),
      "max",
      { today: T },
    );
    expect(h.typicalSamples).toBe(4);
    expect(h.typical).toBe(25);
    expect(h.current?.value).toBe(1000);
    expect(h.deltaVsTypical).toBe(975);
    expect(h.deltaPctVsTypical).toBe(3900);
  });

  it("no readings in the window → typical null even though a record exists", () => {
    const h = buildRecordHistory(pts([["2024-01-01", 70]]), "max", { today: T });
    expect(h.current?.value).toBe(70);
    expect(h.typical).toBeNull();
    expect(h.deltaVsTypical).toBeNull();
    expect(h.deltaPctVsTypical).toBeNull();
  });

  it("typical of 0 gives a raw delta but no percentage", () => {
    const h = buildRecordHistory(pts([["2026-11-25", 0], ["2026-11-26", 0], ["2026-11-27", 3]]), "max", { today: T });
    expect(h.typical).toBe(0);
    expect(h.deltaVsTypical).toBe(3);
    expect(h.deltaPctVsTypical).toBeNull();
  });

  it("a future-dated row (zone skew) clamps days-since to 0 and stays out of typical", () => {
    const h = buildRecordHistory(pts([["2026-11-27", 50], ["2026-11-28", 99]]), "max", { today: T });
    expect(h.current?.value).toBe(99);
    expect(h.daysSinceRecord).toBe(0);
    expect(h.typicalSamples).toBe(1);
    expect(h.typical).toBe(50);
  });

  it("an invalid today leaves days-since and typical empty without throwing", () => {
    const h = buildRecordHistory(pts([["2026-11-27", 50]]), "max", { today: "garbage" });
    expect(h.current?.value).toBe(50);
    expect(h.daysSinceRecord).toBeNull();
    expect(h.typical).toBeNull();
  });

  it("days-since across a DST change is whole calendar days", () => {
    const h = buildRecordHistory(pts([["2026-10-31", 80]]), "max", { today: "2026-11-02" });
    expect(h.daysSinceRecord).toBe(2);
  });
});

describe("buildRecordBoard", () => {
  it("returns every metric in page order, empty series included", () => {
    const series = Object.fromEntries(RECORD_METRICS.map((m) => [m.key, []])) as unknown as RecordSeries;
    series.rhr = pts([["2026-11-01", 50], ["2026-11-02", 47]]);
    const board = buildRecordBoard(series, { today: T });
    expect(board.map((r) => r.key)).toEqual(RECORD_METRICS.map((m) => m.key));
    expect(board.find((r) => r.key === "rhr")?.history.current?.value).toBe(47);
    expect(board.find((r) => r.key === "hrv")?.history.current).toBeNull();
  });
});
