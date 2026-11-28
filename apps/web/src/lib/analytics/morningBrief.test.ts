// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { CycleRow, RecoveryRow, SleepRow, WorkoutRow } from "@/lib/db";
import {
  clockTime,
  composeMorningBrief,
  dayDiff,
  friendlyDate,
  isMorningBriefEnabled,
  priorRecoveryAverage,
  shiftDate,
  type MorningBriefInput,
} from "./morningBrief";

const H = 3_600_000;

function rec(date: string, score: number | null, extra: Partial<RecoveryRow> = {}): RecoveryRow {
  return { date, recovery_score: score, hrv: 60, rhr: 52, spo2: 96, skin_temp: 33.5, ...extra };
}

function slp(date: string, hours: number | null, extra: Partial<SleepRow> = {}): SleepRow {
  const third = hours === null ? null : (hours * H) / 3;
  return {
    date,
    in_bed_ms: hours === null ? null : hours * H + 0.5 * H,
    light_ms: third,
    deep_ms: third,
    rem_ms: third,
    awake_ms: 0.5 * H,
    sleep_need_ms: 8 * H,
    performance: 90,
    efficiency: 92,
    consistency: 80,
    disturbances: 3,
    cycles: 4,
    respiratory_rate: 15,
    need_from_baseline_ms: null,
    need_from_debt_ms: null,
    need_from_strain_ms: null,
    need_from_nap_ms: null,
    start_local: `${shiftDate(date, -1)}T23:42:00`,
    end_local: `${date}T07:31:00`,
    ...extra,
  };
}

function cyc(date: string, strain: number | null): CycleRow {
  return { date, strain, kilojoule: 9000, avg_hr: 70, max_hr: 160 };
}

function wo(date: string, sport: string | null, minutes: number | null): WorkoutRow {
  return {
    id: `${date}-${sport}-${minutes}`,
    date,
    sport,
    duration_sec: minutes === null ? null : minutes * 60,
    avg_hr: 140,
    max_hr: 170,
    strain: 10,
    kilojoule: 1500,
    distance_m: null,
    zone_0_ms: null,
    zone_1_ms: null,
    zone_2_ms: null,
    zone_3_ms: null,
    zone_4_ms: null,
    zone_5_ms: null,
    start_utc: null,
    end_utc: null,
  };
}

function input(over: Partial<MorningBriefInput> = {}): MorningBriefInput {
  return { today: "2026-11-27", recovery: [], sleep: [], cycles: [], workouts: [], ...over };
}

function days(end: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftDate(end, -(n - 1 - i)));
}

const line = (b: ReturnType<typeof composeMorningBrief>, key: string) =>
  b.lines.find((l) => l.key === key);

describe("date helpers", () => {
  it("shifts across month, year and leap-day boundaries", () => {
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2028-03-01", -1)).toBe("2028-02-29");
    expect(shiftDate("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("counts whole days across a DST change (US spring forward / fall back)", () => {
    expect(dayDiff("2026-03-07", "2026-03-09")).toBe(2);
    expect(dayDiff("2026-10-31", "2026-11-02")).toBe(2);
    expect(dayDiff("bad", "2026-11-02")).toBeNull();
  });

  it("formats dates in UTC so the server zone cannot shift the weekday", () => {
    expect(friendlyDate("2026-11-26")).toBe("Thu, Nov 26");
  });

  it("formats naive local clock times", () => {
    expect(clockTime("2026-11-26T23:42:00")).toBe("11:42 PM");
    expect(clockTime("2026-11-27T00:05:00")).toBe("12:05 AM");
    expect(clockTime("2026-11-27T12:00:00")).toBe("12:00 PM");
    expect(clockTime(null)).toBeNull();
    expect(clockTime("garbage")).toBeNull();
  });
});

describe("isMorningBriefEnabled", () => {
  it("is on only for exactly '1'", () => {
    expect(isMorningBriefEnabled({})).toBe(false);
    expect(isMorningBriefEnabled({ MORNING_BRIEF: "0" })).toBe(false);
    expect(isMorningBriefEnabled({ MORNING_BRIEF: "true" })).toBe(false);
    expect(isMorningBriefEnabled({ MORNING_BRIEF: "1" })).toBe(true);
  });
});

describe("priorRecoveryAverage", () => {
  it("averages only the 7 days before the date and needs 3 samples", () => {
    const rows = [rec("2026-11-18", 10), rec("2026-11-20", 60), rec("2026-11-22", 70), rec("2026-11-26", 80), rec("2026-11-27", 99)];
    expect(priorRecoveryAverage(rows, "2026-11-27")).toBe(70);
    expect(priorRecoveryAverage(rows.slice(3), "2026-11-27")).toBeNull();
  });

  it("skips null scores in the window", () => {
    const rows = [rec("2026-11-24", 60), rec("2026-11-25", null), rec("2026-11-26", 80), rec("2026-11-23", 70)];
    expect(priorRecoveryAverage(rows, "2026-11-27")).toBe(70);
  });
});

describe("composeMorningBrief", () => {
  it("first-day user with no data gets a single empty-state line", () => {
    const b = composeMorningBrief(input());
    expect(b.status).toBe("empty");
    expect(b.latestDataDate).toBeNull();
    expect(b.lines).toHaveLength(1);
    expect(b.lines[0].text).toMatch(/No scored data yet/);
  });

  it("rejects a malformed today", () => {
    expect(() => composeMorningBrief(input({ today: "11/27/2026" }))).toThrow();
  });

  it("full green morning: readiness, sleep, yesterday, suggestion", () => {
    const b = composeMorningBrief(
      input({
        recovery: [rec("2026-11-24", 60), rec("2026-11-25", 62), rec("2026-11-26", 64), rec("2026-11-27", 78)],
        sleep: [slp("2026-11-27", 7.8)],
        cycles: [cyc("2026-11-26", 14.23), cyc("2026-11-27", 2)],
        workouts: [wo("2026-11-26", "running", 45), wo("2026-11-26", "weightlifting", 30), wo("2026-11-25", "cycling", 60)],
      }),
    );
    expect(b.status).toBe("ok");
    expect(b.anchorDate).toBe("2026-11-27");
    expect(line(b, "readiness")).toMatchObject({ text: "78% · Green · +16 vs 7-day avg 62%", tone: "good", note: null });
    expect(line(b, "sleep")).toMatchObject({
      text: "7.8 h of 8.0 h need · 90% performance · 11:42 PM → 7:31 AM",
      tone: "good",
    });
    expect(line(b, "yesterday")).toMatchObject({
      label: "Yesterday",
      text: "Strain 14.2 · Running 45 min, Weightlifting 30 min",
    });
    expect(line(b, "watch")).toBeUndefined();
    expect(line(b, "suggestion")?.text).toBe("Recovery is green and you slept 7.8 h — good day for a hard session.");
    expect(b.lines.length).toBeGreaterThanOrEqual(4);
    expect(b.lines.length).toBeLessThanOrEqual(6);
  });

  it("no scored recovery yet today: uses the latest scored day and says so", () => {
    const b = composeMorningBrief(
      input({
        recovery: [rec("2026-11-26", 50), rec("2026-11-27", null)],
        sleep: [slp("2026-11-26", 6.5), slp("2026-11-27", null)],
        cycles: [cyc("2026-11-25", 11), cyc("2026-11-27", 1)],
      }),
    );
    expect(b.anchorDate).toBe("2026-11-26");
    expect(b.latestDataDate).toBe("2026-11-27");
    expect(line(b, "readiness")?.note).toBe("No scored recovery yet today — latest is Thu, Nov 26");
    expect(line(b, "readiness")?.tone).toBe("warn");
    expect(line(b, "sleep")?.text).toMatch(/^6\.5 h/);
    expect(line(b, "yesterday")).toMatchObject({ label: "Wed, Nov 25", text: "Strain 11.0 · no workouts" });
    expect(line(b, "suggestion")?.note).toBe("based on Thu, Nov 26");
  });

  it("stale data days old reports the latest data date for the freshness banner", () => {
    const b = composeMorningBrief(input({ recovery: [rec("2026-11-23", 40)], sleep: [slp("2026-11-23", 7)] }));
    expect(b.latestDataDate).toBe("2026-11-23");
    expect(dayDiff(b.latestDataDate!, b.today)).toBe(4);
  });

  it("only sleep (mid-sync, recovery not written yet)", () => {
    const b = composeMorningBrief(input({ sleep: [slp("2026-11-27", 8)] }));
    expect(b.status).toBe("ok");
    expect(line(b, "readiness")?.text).toBe("No scored recovery yet");
    expect(line(b, "sleep")?.note).toBeNull();
    expect(line(b, "yesterday")?.text).toBe("No strain recorded");
    expect(line(b, "watch")).toBeUndefined();
    expect(line(b, "suggestion")?.text).toMatch(/isn't scored yet/);
  });

  it("single day of data omits the 7-day comparison", () => {
    const b = composeMorningBrief(input({ recovery: [rec("2026-11-27", 70)] }));
    expect(line(b, "readiness")?.text).toBe("70% · Green");
    expect(line(b, "sleep")?.text).toBe("No sleep recorded");
    expect(line(b, "suggestion")?.text).toBe("Recovery is green — good day for a hard session.");
  });

  it("nulls in sleep fields degrade gracefully", () => {
    const b = composeMorningBrief(
      input({
        recovery: [rec("2026-11-27", 70)],
        sleep: [slp("2026-11-27", null, { performance: null, start_local: null, sleep_need_ms: null })],
      }),
    );
    expect(line(b, "sleep")).toMatchObject({ text: "Sleep recorded, details pending", tone: "neutral" });
  });

  it("sleep from an earlier night is labelled with its date", () => {
    const b = composeMorningBrief(input({ recovery: [rec("2026-11-27", 70)], sleep: [slp("2026-11-25", 7)] }));
    expect(line(b, "sleep")?.note).toBe("from Wed, Nov 25");
  });

  it("ignores rows dated after today", () => {
    const b = composeMorningBrief(input({ recovery: [rec("2026-11-27", 70), rec("2026-11-28", 5)] }));
    expect(b.anchorDate).toBe("2026-11-27");
    expect(b.latestDataDate).toBe("2026-11-27");
  });

  it("short sleep on a green day caps intensity", () => {
    const b = composeMorningBrief(input({ recovery: [rec("2026-11-27", 80)], sleep: [slp("2026-11-27", 5.5)] }));
    expect(line(b, "sleep")?.tone).toBe("bad");
    expect(line(b, "suggestion")?.text).toMatch(/sleep was short \(5\.5 h\)/);
  });

  it("red and yellow recovery suggestions", () => {
    const red = composeMorningBrief(input({ recovery: [rec("2026-11-27", 20)] }));
    expect(line(red, "readiness")?.tone).toBe("bad");
    expect(line(red, "suggestion")?.text).toMatch(/red — make it a rest/);
    const yellow = composeMorningBrief(input({ recovery: [rec("2026-11-27", 50)] }));
    expect(line(yellow, "suggestion")?.text).toMatch(/yellow — a moderate session/);
  });

  it("caps the workout list at three", () => {
    const b = composeMorningBrief(
      input({
        recovery: [rec("2026-11-27", 70)],
        workouts: ["a", "b", "c", "d", "e"].map((s) => wo("2026-11-26", s, 10)),
      }),
    );
    expect(line(b, "yesterday")?.text).toBe("A 10 min, B 10 min, C 10 min +2 more");
  });

  it("fires the illness watch-out and switches the suggestion to rest", () => {
    const baseline = days("2026-11-26", 14).map((d) => rec(d, 65, { rhr: 50, hrv: 70, skin_temp: 33.5 }));
    const b = composeMorningBrief(
      input({
        recovery: [...baseline, rec("2026-11-27", 70, { rhr: 56, hrv: 55, skin_temp: 33.6 })],
      }),
    );
    const watch = line(b, "watch");
    expect(watch?.text).toBe("Possible illness signal — RHR +6 bpm, HRV −21% vs your 14-day baseline");
    expect(line(b, "suggestion")?.text).toMatch(/fighting something/);
  });

  it("fires the overtraining watch-out when 2+ OTS signals trend under strain", () => {
    const dates = days("2026-11-27", 7);
    const b = composeMorningBrief(
      input({
        recovery: dates.map((d, i) => rec(d, 70 - i * 2, { hrv: 80 - i * 3, rhr: 50 + (i % 2) })),
        cycles: dates.map((d, i) => cyc(d, 12 + i)),
      }),
    );
    expect(line(b, "watch")?.text).toMatch(/^Overtraining signs — HRV trending down/);
    expect(line(b, "suggestion")?.text).toMatch(/Load has outpaced recovery/);
  });

  it("does not evaluate watch-outs without a scored recovery", () => {
    const b = composeMorningBrief(input({ cycles: [cyc("2026-11-26", 20)] }));
    expect(line(b, "watch")).toBeUndefined();
  });
});
