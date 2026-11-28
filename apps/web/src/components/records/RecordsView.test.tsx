import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RecordsView, { formatRecordDate, formatRecordDelta, formatRecordValue } from "./RecordsView";
import { buildRecordBoard, RECORD_METRICS, type RecordSeries } from "@/lib/analytics/records";

const T = "2026-11-27";
const empty = () => Object.fromEntries(RECORD_METRICS.map((m) => [m.key, []])) as unknown as RecordSeries;
const noStreaks = { recoveryStreak: null, sleepPerfStreak: null, loggingStreak: null };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("formatters", () => {
  it("formats each metric in its own unit", () => {
    expect(formatRecordValue("hrv", 88.4)).toBe("88 ms");
    expect(formatRecordValue("rhr", 47.6)).toBe("48 bpm");
    expect(formatRecordValue("recovery", 99)).toBe("99%");
    expect(formatRecordValue("strain", 18.25)).toBe("18.3");
    expect(formatRecordValue("sleepDuration", 9 * 3_600_000 + 5 * 60_000)).toBe("9h 05m");
    expect(formatRecordValue("workoutDuration", 45 * 60)).toBe("45m");
    expect(formatRecordValue("steps", 23456)).toBe("23,456");
  });

  it("formats percent-metric gaps as points, others in their own unit", () => {
    expect(formatRecordDelta("recovery", 34.4)).toBe("34 pts");
    expect(formatRecordDelta("sleepPerformance", 19)).toBe("19 pts");
    expect(formatRecordDelta("hrv", 12.2)).toBe("12 ms");
  });

  it("formats calendar dates without shifting the day", () => {
    expect(formatRecordDate("2026-03-08")).toBe("Mar 8, 2026");
    expect(formatRecordDate("2026-01-01")).toBe("Jan 1, 2026");
  });
});

describe("RecordsView", () => {
  it("renders an empty state for a user with no data", () => {
    const html = renderToString(<RecordsView board={buildRecordBoard(empty(), { today: T })} streaks={noStreaks} today={T} />);
    const t = text(html);
    expect(t).toContain("No records yet");
    expect(html.match(/No data yet\./g)?.length).toBe(RECORD_METRICS.length + 3);
  });

  it("renders the record, comparison, days-since and progression", () => {
    const s = empty();
    s.hrv = [
      { date: "2026-06-01", value: 70 }, { date: "2026-08-01", value: 80 },
      { date: "2026-09-01", value: 90 }, { date: "2026-10-01", value: 95 },
      { date: "2026-11-20", value: 104 }, { date: "2026-11-26", value: 60 },
    ];
    s.rhr = [{ date: "2026-11-27", value: 50 }];
    s.workoutDuration = [{ date: "2026-11-01", value: 5400, note: "Cycling" }];
    const html = renderToString(
      <RecordsView
        board={buildRecordBoard(s, { today: T })}
        streaks={{ ...noStreaks, loggingStreak: { count: 12, start_date: "2026-11-01", end_date: "2026-11-12" } }}
        today={T}
      />,
    );
    const t = text(html);
    expect(t).toContain("across 3 metrics");
    expect(t).toContain("104 ms");
    expect(t).toContain("Nov 20, 2026");
    expect(t).toContain("Set 7 days ago");
    // window = Aug 30..Nov 27 → median(90, 95, 104, 60) = 92.5 → +11.5 ms (12%)
    expect(t).toContain("12 ms (12%) above your 90-day typical of 93 ms (median of 4 days)");
    // progression newest first, capped at 3
    const hrv = html.slice(html.indexOf('data-record="hrv"'), html.indexOf('data-record="rhr"'));
    expect(text(hrv).indexOf("95 ms")).toBeLessThan(text(hrv).indexOf("90 ms"));
    expect(text(hrv)).toContain("80 ms");
    expect(text(hrv)).not.toContain("70 ms");
    // first-day metric
    expect(t).toContain("First reading — the record to beat.");
    expect(t).toContain("Set today");
    expect(t).toContain("Right at your 90-day typical");
    // note carried and stale record without window data
    expect(t).toContain("1h 30m Cycling");
    expect(t).toContain("12 days");
    expect(t).toContain("Nov 1, 2026 → Nov 12, 2026");
  });

  it("describes lower-is-better metrics as below typical and labels ties", () => {
    const s = empty();
    s.rhr = [{ date: "2026-11-10", value: 45 }, { date: "2026-11-20", value: 45 }, { date: "2026-11-25", value: 55 }];
    const t = text(renderToString(<RecordsView board={buildRecordBoard(s, { today: T })} streaks={noStreaks} today={T} />));
    expect(t).toContain("matched 1 more time, latest Nov 20, 2026");
    expect(t).toContain("Last matched 7 days ago");
    // typical = median(45, 45, 55) = 45 → the record equals it
    expect(t).toContain("Right at your 90-day typical (45 bpm, 3 days)");
  });

  it("ships no client JS markers (plain server markup)", () => {
    const html = renderToString(<RecordsView board={buildRecordBoard(empty(), { today: T })} streaks={noStreaks} today={T} />);
    expect(html).not.toMatch(/<script|<button|onclick/i);
  });
});
