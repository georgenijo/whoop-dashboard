// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SleepRow } from "@/lib/db/sleep";
import {
  HISTORY_DAYS,
  MIN_NIGHTS,
  buildTakeaway,
  computeSleepStages,
  formatMin,
  parseStagesWindow,
  positionIn,
  quantile,
  shiftDate,
  slopePerDay,
  stageStats,
  stageTrend,
  toStageNights,
  typicalRange,
  type StageNight,
} from "./sleepStages";

const MIN = 60_000;

function row(date: string, deep: number | null, rem: number | null, light: number | null = 240, awake: number | null = 30): SleepRow {
  return {
    date,
    in_bed_ms: null,
    light_ms: light == null ? null : light * MIN,
    deep_ms: deep == null ? null : deep * MIN,
    rem_ms: rem == null ? null : rem * MIN,
    awake_ms: awake == null ? null : awake * MIN,
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
    start_local: null,
    end_local: null,
  };
}

/** n consecutive nights ending `end`, deep/rem from callbacks of the age index (0 = end). */
function nights(end: string, n: number, deep: (i: number) => number, rem: (i: number) => number = () => 100): SleepRow[] {
  return Array.from({ length: n }, (_, k) => {
    const i = n - 1 - k;
    return row(shiftDate(end, -i), deep(i), rem(i));
  });
}

const night = (date: string, deep: number, rem = 100): StageNight => ({
  date, deep, rem, light: 240, awake: 30, total: deep + rem + 270,
});

describe("parseStagesWindow", () => {
  it.each([
    ["14", 14], ["30", 30], ["90", 90], [undefined, 30], ["", 30], ["7", 30], ["90.0", 30], ["abc", 30],
  ] as const)("%s → %d", (raw, want) => {
    expect(parseStagesWindow(raw)).toBe(want);
  });
});

describe("quantile / positionIn", () => {
  it("interpolates like numpy's default", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([4, 1, 3, 2], 0.75)).toBe(3.25);
    expect(quantile([5], 0.25)).toBe(5);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });
  it("boundaries are within", () => {
    expect(positionIn(10, 10, 20)).toBe("within");
    expect(positionIn(20, 10, 20)).toBe("within");
    expect(positionIn(9.99, 10, 20)).toBe("below");
    expect(positionIn(20.01, 10, 20)).toBe("above");
  });
});

describe("toStageNights", () => {
  it("excludes nights missing any stage and counts them as recorded", () => {
    const rows = [
      row("2026-11-01", 60, 90),
      row("2026-11-02", null, 90),
      row("2026-11-03", 60, null),
      row("2026-11-04", 60, 90, null),
      row("2026-11-05", 60, 90, 240, null),
      row("2026-11-06", 0, 0, 0, 30), // no asleep time
      row("2026-11-07", -5, 90),
      row("2026-11-08", 60, 90),
    ];
    const { nights: ns, recorded } = toStageNights(rows, "2026-11-01", "2026-11-08");
    expect(recorded).toBe(8);
    expect(ns.map((n) => n.date)).toEqual(["2026-11-01", "2026-11-08"]);
  });
  it("clips to [start, end], sorts, and keeps one row per date", () => {
    const rows = [row("2026-11-05", 50, 90), row("2026-10-31", 10, 10), row("2026-11-02", 40, 90), row("2026-11-02", 99, 99), row("2026-11-06", 1, 1)];
    const { nights: ns, recorded } = toStageNights(rows, "2026-11-01", "2026-11-05");
    expect(recorded).toBe(2);
    expect(ns.map((n) => [n.date, n.deep])).toEqual([["2026-11-02", 40], ["2026-11-05", 50]]);
  });
  it("converts ms to minutes and totals all four stages", () => {
    const [n] = toStageNights([row("2026-11-01", 61.5, 95, 250, 20)], "2026-11-01", "2026-11-01").nights;
    expect(n).toEqual({ date: "2026-11-01", deep: 61.5, rem: 95, light: 250, awake: 20, total: 426.5 });
  });
});

describe("stageStats", () => {
  it("mean/median minutes and % (shares add to 100)", () => {
    const s = stageStats([night("a", 60), night("b", 90), night("c", 120)]);
    expect(s.deep.meanMin).toBe(90);
    expect(s.deep.medianMin).toBe(90);
    expect(s.light.medianMin).toBe(240);
    const sumPct = s.deep.meanPct + s.rem.meanPct + s.light.meanPct + s.awake.meanPct;
    expect(sumPct).toBeCloseTo(100, 9);
    expect(s.deep.medianPct).toBeCloseTo((90 / 460) * 100, 9);
  });
});

describe("typicalRange", () => {
  const hist = Array.from({ length: 8 }, (_, i) => night(shiftDate("2026-11-01", i), 50 + i * 10));
  it("excludes the latest night from its own range", () => {
    const latest = night("2026-11-20", 500);
    const r = typicalRange([...hist, latest], latest, "deep")!;
    expect(r.n).toBe(8);
    expect(r.p25).toBe(67.5);
    expect(r.p75).toBe(102.5);
    expect(r.position).toBe("above");
  });
  it("below and within", () => {
    expect(typicalRange([...hist, night("2026-11-20", 20)], night("2026-11-20", 20), "deep")!.position).toBe("below");
    expect(typicalRange([...hist, night("2026-11-20", 80)], night("2026-11-20", 80), "deep")!.position).toBe("within");
  });
  it("null under MIN_NIGHTS earlier nights or with no latest", () => {
    const short = hist.slice(0, MIN_NIGHTS - 1);
    const latest = night("2026-11-20", 80);
    expect(typicalRange([...short, latest], latest, "deep")).toBeNull();
    expect(typicalRange(hist, null, "rem")).toBeNull();
  });
});

describe("slopePerDay", () => {
  it("uses calendar day, so gaps are respected", () => {
    // y = 2x on days 0, 1, 10.
    const s = slopePerDay([
      { date: "2026-11-01", y: 0 },
      { date: "2026-11-02", y: 2 },
      { date: "2026-11-11", y: 20 },
    ]);
    expect(s).toBeCloseTo(2, 9);
  });
  it("null for <2 points", () => {
    expect(slopePerDay([])).toBeNull();
    expect(slopePerDay([{ date: "2026-11-01", y: 1 }])).toBeNull();
  });
  it("is exact across the US DST fall-back weekend (Nov 1 2026)", () => {
    const pts = ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"].map((date, i) => ({ date, y: i * 3 }));
    expect(slopePerDay(pts)).toBeCloseTo(3, 9);
  });
});

describe("stageTrend", () => {
  const today = "2026-11-27";
  it("recent 30 vs prior 30, with direction and min/week slope", () => {
    const hist = toStageNights(nights(today, 60, (i) => (i < 30 ? 80 : 60)), "2026-01-01", today).nights;
    const t = stageTrend(hist, today, "deep");
    expect(t.recentNights).toBe(30);
    expect(t.priorNights).toBe(30);
    expect(t.recentMean).toBe(80);
    expect(t.priorMean).toBe(60);
    expect(t.delta).toBe(20);
    expect(t.direction).toBe("up");
    expect(t.slopePerWeek).toBeCloseTo(0, 9);
  });
  it("steady under 5 minutes, down when lower", () => {
    const steady = toStageNights(nights(today, 60, (i) => (i < 30 ? 63 : 60)), "2026-01-01", today).nights;
    expect(stageTrend(steady, today, "deep").direction).toBe("steady");
    const down = toStageNights(nights(today, 60, (i) => (i < 30 ? 50 : 60)), "2026-01-01", today).nights;
    expect(stageTrend(down, today, "deep").direction).toBe("down");
  });
  it("no prior data → no delta/direction, slope still shown", () => {
    const hist = toStageNights(nights(today, 20, (i) => 100 - i), "2026-01-01", today).nights;
    const t = stageTrend(hist, today, "deep");
    expect(t.priorMean).toBeNull();
    expect(t.delta).toBeNull();
    expect(t.direction).toBeNull();
    expect(t.slopePerWeek).toBeCloseTo(7, 9);
  });
  it("too few recent nights → no slope", () => {
    const hist = toStageNights(nights(today, MIN_NIGHTS - 1, () => 60), "2026-01-01", today).nights;
    expect(stageTrend(hist, today, "rem").slopePerWeek).toBeNull();
  });
});

describe("computeSleepStages", () => {
  const today = "2026-11-27";
  it("empty data → insufficient", () => {
    const r = computeSleepStages([], today, 30);
    expect(r.status).toBe("insufficient");
    expect(r.start).toBe("2026-10-29");
    expect(r.nights).toHaveLength(0);
    expect(r.recordedNights).toBe(0);
  });
  it("one night → insufficient", () => {
    expect(computeSleepStages([row(today, 60, 90)], today, 14).status).toBe("insufficient");
  });
  it("counts no-stage nights and stays insufficient when stage nights < 7", () => {
    const rows = [...nights(today, 6, () => 60), row("2026-11-20", null, null, null, null), row("2026-11-19", null, 90)];
    const r = computeSleepStages(rows, today, 14);
    expect(r.status).toBe("insufficient");
    expect(r.recordedNights).toBe(8);
    expect(r.noStageNights).toBe(2);
  });
  it("exactly 7 stage nights with gaps → ok", () => {
    const rows = [0, 2, 4, 6, 8, 10, 12].map((i) => row(shiftDate(today, -i), 60 + i, 90));
    const r = computeSleepStages(rows, today, 14);
    expect(r.status).toBe("ok");
    expect(r.nights).toHaveLength(7);
    if (r.status !== "ok") return;
    expect(r.latest!.date).toBe(today);
    expect(r.ranges.deep).toBeNull(); // only 6 earlier nights
  });
  it("window slices the display; history powers range and trend", () => {
    // 120 nights: deep 60 long ago, last night 30 (below), REM constant 100.
    const rows = nights(today, 120, (i) => (i === 0 ? 30 : 60 + (i % 5)));
    const r = computeSleepStages(rows, today, 14);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.nights).toHaveLength(14);
    expect(r.start).toBe("2026-11-14");
    expect(r.ranges.deep!.n).toBe(119);
    expect(r.ranges.deep!.position).toBe("below");
    expect(r.ranges.rem!.position).toBe("within");
    expect(r.takeaway).toContain("deep sleep (30 min) was below your typical");
    expect(r.takeaway).toContain("REM (1h 40m) was within");
  });
  it("ignores rows older than the history window", () => {
    const old = row(shiftDate(today, -HISTORY_DAYS), 999, 999);
    const r = computeSleepStages([old, ...nights(today, 10, () => 60)], today, 90);
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.ranges.deep!.p75).toBe(60);
  });
  it("DST boundaries: the day grid is unaffected by spring-forward and fall-back", () => {
    const spring = computeSleepStages(nights("2026-03-10", 14, () => 60), "2026-03-10", 14);
    expect(spring.start).toBe("2026-02-25");
    expect(spring.nights).toHaveLength(14);
    const fall = computeSleepStages(nights("2026-11-03", 14, () => 60), "2026-11-03", 14);
    expect(new Set(fall.nights.map((n) => n.date)).size).toBe(14);
    expect(fall.nights.map((n) => n.date)).toContain("2026-11-01");
  });
});

describe("buildTakeaway", () => {
  const steady = stageTrend([], "2026-11-27", "deep");
  it("falls back when nothing is comparable", () => {
    expect(buildTakeaway(null, { deep: null, rem: null }, { deep: steady, rem: { ...steady, stage: "rem" } })).toMatch(/usual/);
  });
  it("adds advice when both stages are below range", () => {
    const low = { stage: "deep" as const, p25: 60, p75: 90, n: 30, latest: 40, position: "below" as const };
    const t = buildTakeaway(night("2026-11-27", 40, 50), { deep: low, rem: { ...low, stage: "rem", latest: 50 } }, { deep: steady, rem: steady });
    expect(t).toContain("Both were short");
  });
});

describe("formatMin", () => {
  it.each([[0, "0 min"], [59.4, "59 min"], [60, "1h"], [95, "1h 35m"], [119.6, "2h"]])("%d → %s", (m, s) => {
    expect(formatMin(m)).toBe(s);
  });
});
