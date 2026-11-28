import { describe, expect, it } from "vitest";
import type { RecoveryRow } from "@/lib/db/recovery";
import type { SleepRow } from "@/lib/db/sleep";
import type { CycleRow } from "@/lib/db/strain";
import { shiftDate } from "@/lib/range";
import {
  MIN_BUCKET_DAYS,
  MIN_HISTORY_DAYS,
  bandFor,
  buildSamples,
  computeLevers,
  computeRecoveryOutlook,
  isRecoveryOutlookEnabled,
  percentile,
  sleepBucketFor,
  sleepNeedMetPct,
  strainBucketFor,
  theilSenSlope,
  usualSleepBucket,
  type Sample,
} from "./recoveryOutlook";

const TODAY = "2026-11-27";
const H = 3_600_000;

const rec = (date: string, score: number | null): RecoveryRow => ({
  date, recovery_score: score, hrv: null, rhr: null, spo2: null, skin_temp: null,
});
const slp = (date: string, over: Partial<SleepRow> = {}): SleepRow => ({
  date, in_bed_ms: null, light_ms: 4 * H, deep_ms: 1.5 * H, rem_ms: 1.5 * H, awake_ms: null,
  sleep_need_ms: 8 * H, performance: 90, efficiency: null, consistency: 70, disturbances: null,
  cycles: null, respiratory_rate: null, need_from_baseline_ms: null, need_from_debt_ms: null,
  need_from_strain_ms: null, need_from_nap_ms: null, start_local: null, end_local: null, ...over,
});
const cyc = (date: string, strain: number | null): CycleRow => ({
  date, strain, kilojoule: null, avg_hr: null, max_hr: null,
});

const sample = (over: Partial<Sample>): Sample => ({
  date: "2026-01-01", recovery: 50, sleepPct: null, sleepBucket: null, sleepHours: null,
  consistency: null, priorStrain: null, strainBucket: null, ...over,
});

/** n consecutive days ending at `end`, built by fn(i, date). */
function days(n: number, end: string) {
  return Array.from({ length: n }, (_, i) => shiftDate(end, -(n - 1 - i)));
}

describe("flag", () => {
  it("is on only for exactly '1'", () => {
    expect(isRecoveryOutlookEnabled({ RECOVERY_OUTLOOK: "1" })).toBe(true);
    for (const v of [undefined, "", "0", "true", " 1"]) {
      expect(isRecoveryOutlookEnabled({ RECOVERY_OUTLOOK: v })).toBe(false);
    }
  });
});

describe("bucket edges", () => {
  it("sleep buckets are lower-bound inclusive", () => {
    expect(sleepBucketFor(69.999)).toBe("short");
    expect(sleepBucketFor(70)).toBe("fair");
    expect(sleepBucketFor(84.9)).toBe("fair");
    expect(sleepBucketFor(85)).toBe("met");
    expect(sleepBucketFor(140)).toBe("met");
    expect(sleepBucketFor(0)).toBe("short");
    expect(sleepBucketFor(null)).toBeNull();
    expect(sleepBucketFor(NaN)).toBeNull();
  });
  it("strain buckets are lower-bound inclusive and reject bad values", () => {
    expect(strainBucketFor(0)).toBe("light");
    expect(strainBucketFor(9.99)).toBe("light");
    expect(strainBucketFor(10)).toBe("moderate");
    expect(strainBucketFor(13.99)).toBe("moderate");
    expect(strainBucketFor(14)).toBe("high");
    expect(strainBucketFor(21)).toBe("high");
    expect(strainBucketFor(-1)).toBeNull();
    expect(strainBucketFor(null)).toBeNull();
    expect(strainBucketFor(Infinity)).toBeNull();
  });
});

describe("sleepNeedMetPct", () => {
  it("prefers Whoop performance", () => {
    expect(sleepNeedMetPct(slp("d", { performance: 77 }))).toBe(77);
  });
  it("falls back to asleep ÷ need", () => {
    expect(sleepNeedMetPct(slp("d", { performance: null }))).toBeCloseTo(87.5);
  });
  it("never divides by a zero or missing need", () => {
    expect(sleepNeedMetPct(slp("d", { performance: null, sleep_need_ms: 0 }))).toBeNull();
    expect(sleepNeedMetPct(slp("d", { performance: null, sleep_need_ms: null }))).toBeNull();
    expect(sleepNeedMetPct(slp("d", { performance: null, rem_ms: null }))).toBeNull();
  });
});

describe("percentile / theilSenSlope", () => {
  it("handles empty, single and interpolated cases", () => {
    expect(percentile([], 0.5)).toBeNaN();
    expect(percentile([42], 0.9)).toBe(42);
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([10, 20, 30, 40], 0.25)).toBe(17.5);
  });
  it("returns null when every x is equal (no divide by zero)", () => {
    expect(theilSenSlope([{ x: 7, y: 10 }, { x: 7, y: 90 }])).toBeNull();
    expect(theilSenSlope([])).toBeNull();
  });
  it("ignores an outlier", () => {
    const pts = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 2 * i }));
    pts.push({ x: 5, y: 500 });
    expect(theilSenSlope(pts)).toBeCloseTo(2, 5);
  });
});

describe("buildSamples", () => {
  it("pairs recovery D with sleep D and strain D-1 across a DST boundary and month end", () => {
    // US DST ended 2026-11-01; recovery 2026-11-01 pairs with cycle 2026-10-31.
    const samples = buildSamples({
      today: TODAY,
      recovery: [rec("2026-11-01", 60), rec("2026-12-01", 99)],
      sleep: [slp("2026-11-01", { performance: 72 })],
      cycles: [cyc("2026-10-31", 15.2)],
    });
    expect(samples).toHaveLength(1); // future-dated row ignored
    expect(samples[0]).toMatchObject({
      date: "2026-11-01", recovery: 60, sleepBucket: "fair", priorStrain: 15.2, strainBucket: "high",
    });
  });
  it("drops null/NaN scores, clamps out-of-range ones, de-duplicates dates and sorts", () => {
    const samples = buildSamples({
      today: TODAY,
      recovery: [rec("2026-11-05", 50), rec("2026-11-03", null), rec("2026-11-04", NaN), rec("2026-11-02", 140), rec("2026-11-05", 55)],
      sleep: [],
      cycles: [cyc("2026-11-01", -3)],
    });
    expect(samples.map((s) => [s.date, s.recovery])).toEqual([["2026-11-02", 100], ["2026-11-05", 55]]);
    expect(samples[0].priorStrain).toBeNull();
    expect(samples[0].sleepBucket).toBeNull();
  });
});

describe("bandFor fallbacks", () => {
  const cell = Array.from({ length: MIN_BUCKET_DAYS }, (_, i) =>
    sample({ recovery: 70 + i, sleepBucket: "met", strainBucket: "light" }));
  const sleepOnly = Array.from({ length: 10 }, (_, i) =>
    sample({ recovery: 40 + i, sleepBucket: "short", strainBucket: "high" }));

  it("uses the sleep × strain cell when it has enough days", () => {
    const b = bandFor([...cell, ...sleepOnly], "met", "light");
    expect(b).toMatchObject({ basis: "cell", n: 5, low: 71, median: 72, high: 73, confidence: "low" });
  });
  it("falls back to the sleep bucket when the cell is thin (n < 5)", () => {
    const b = bandFor([...cell.slice(0, 4), ...sleepOnly], "short", "light");
    expect(b.basis).toBe("sleep");
    expect(b.n).toBe(10);
    expect(b.confidence).toBe("medium");
  });
  it("falls back to overall with a wider 10–90 band when nothing matches", () => {
    const all = [...cell.slice(0, 4), ...sleepOnly];
    const b = bandFor(all, "fair", "moderate");
    expect(b.basis).toBe("overall");
    expect(b.n).toBe(14);
    expect(b.confidence).toBe("low");
    expect(b.low).toBeLessThanOrEqual(b.median);
    expect(b.high).toBeGreaterThanOrEqual(b.median);
  });
  it("uses the strain bucket when sleep is unknown", () => {
    expect(bandFor(sleepOnly, null, "high").basis).toBe("strain");
  });
  it("reaches high confidence at 20 days in a cell", () => {
    const many = Array.from({ length: 20 }, () => sample({ recovery: 60, sleepBucket: "met", strainBucket: "light" }));
    expect(bandFor(many, "met", "light")).toMatchObject({ confidence: "high", low: 60, high: 60 });
  });
});

describe("usualSleepBucket", () => {
  it("is null without sleep data", () => {
    expect(usualSleepBucket([sample({}), sample({})])).toBeNull();
  });
  it("breaks ties toward the most recent night", () => {
    const s = [sample({ sleepBucket: "met" }), sample({ sleepBucket: "short" })];
    expect(usualSleepBucket(s)).toBe("short");
    expect(usualSleepBucket([...s, sample({ sleepBucket: "met" })])).toBe("met");
  });
  it("only looks at the last 14 nights", () => {
    const old = Array.from({ length: 20 }, () => sample({ sleepBucket: "met" }));
    const recent = Array.from({ length: 14 }, () => sample({ sleepBucket: "fair" }));
    expect(usualSleepBucket([...old, ...recent])).toBe("fair");
  });
});

describe("computeLevers", () => {
  it("ranks the two biggest levers with signed points", () => {
    const s = Array.from({ length: 20 }, (_, i) =>
      sample({ recovery: 30 + 6 * (i % 5) - 2 * (i % 4), sleepHours: 6 + (i % 5), priorStrain: 8 + (i % 4), consistency: 60 }));
    const levers = computeLevers(s);
    expect(levers.map((l) => l.key)).toEqual(["sleep_hours", "strain"]);
    expect(levers[0]).toMatchObject({ points: 6, n: 20, change: "+1 h of sleep tonight" });
    expect(levers[1].points).toBe(4); // −2 strain × −2 pts/strain
  });
  it("skips levers with too few days, flat x, or negligible effect", () => {
    const few = Array.from({ length: 13 }, (_, i) => sample({ recovery: i * 10, sleepHours: i }));
    expect(computeLevers(few)).toEqual([]);
    const flat = Array.from({ length: 20 }, (_, i) => sample({ recovery: i, consistency: 80, sleepHours: 7 + i * 0.001 }));
    // sleep spread is 0.02 h (< 1 h step) → would be a 1000-pt extrapolation; consistency is flat.
    expect(computeLevers(flat)).toEqual([]);
    const tiny = Array.from({ length: 20 }, (_, i) => sample({ recovery: 50 + (i % 2) * 0.5, sleepHours: 5 + (i % 2) * 3 }));
    expect(computeLevers(tiny)).toEqual([]); // 0.17 pts per hour < 1
  });
});

describe("computeRecoveryOutlook", () => {
  it("empty data → not enough data", () => {
    expect(computeRecoveryOutlook({ today: TODAY, recovery: [], sleep: [], cycles: [] }))
      .toEqual({ status: "insufficient", scoredDays: 0, minDays: MIN_HISTORY_DAYS });
  });
  it("one day → not enough data", () => {
    const r = computeRecoveryOutlook({ today: TODAY, recovery: [rec(TODAY, 50)], sleep: [], cycles: [] });
    expect(r).toMatchObject({ status: "insufficient", scoredDays: 1 });
  });
  it("counts only scored days toward the minimum (gaps and nulls)", () => {
    const ds = days(30, TODAY);
    const recovery = ds.map((d, i) => rec(d, i % 3 === 0 ? 60 : null)); // 10 scored
    expect(computeRecoveryOutlook({ today: TODAY, recovery, sleep: [], cycles: [] }).status).toBe("insufficient");
  });

  it("builds a cell band from realistic history, tomorrow across a month edge", () => {
    const today = "2026-11-30";
    const ds = days(60, today);
    const recovery: RecoveryRow[] = [];
    const sleep: SleepRow[] = [];
    const cycles: CycleRow[] = [];
    ds.forEach((d, i) => {
      const good = i % 2 === 0;
      recovery.push(rec(d, good ? 75 + (i % 5) : 45 + (i % 5)));
      sleep.push(slp(d, { performance: good ? 92 : 65, light_ms: (good ? 5 : 3.5) * H }));
      cycles.push(cyc(d, i % 3 === 0 ? 15 : 8));
    });
    const r = computeRecoveryOutlook({ today, recovery, sleep, cycles });
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.targetDate).toBe("2026-12-01");
    expect(r.todayStrain).toBe(8); // i=59 → 59 % 3 = 2 → light
    expect(r.strainBucket).toBe("light");
    expect(r.scoredDays).toBe(60);
    expect(r.scenarios.map((s) => s.sleep)).toEqual(["short", "fair", "met"]);
    const met = r.scenarios.find((s) => s.sleep === "met")!.band;
    const short = r.scenarios.find((s) => s.sleep === "short")!.band;
    expect(met.basis).toBe("cell");
    expect(met.low).toBeGreaterThanOrEqual(75);
    expect(short.high).toBeLessThanOrEqual(49);
    expect(r.scenarios.find((s) => s.sleep === "fair")!.band.basis).toBe("overall");
    expect(r.levers[0]?.key).toBe("sleep_hours");
    expect(r.levers[0]!.points).toBeGreaterThan(0);
  });

  it("without today's strain, skips the cell level and still answers", () => {
    const ds = days(20, TODAY);
    const r = computeRecoveryOutlook({
      today: TODAY,
      recovery: ds.map((d) => rec(d, 60)),
      sleep: ds.map((d) => slp(d)),
      cycles: [],
    });
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.todayStrain).toBeNull();
    expect(r.assumedSleep).toBe("met");
    expect(r.headline).toMatchObject({ basis: "sleep", low: 60, high: 60, median: 60, n: 20 });
    expect(r.levers).toEqual([]); // flat recovery → no lever
  });

  it("without any sleep data, falls back to overall for every scenario", () => {
    const ds = days(20, TODAY);
    const r = computeRecoveryOutlook({ today: TODAY, recovery: ds.map((d, i) => rec(d, 40 + i)), sleep: [], cycles: [] });
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.assumedSleep).toBeNull();
    expect(r.headline.basis).toBe("overall");
    expect(r.scenarios.every((s) => s.band.basis === "overall")).toBe(true);
    expect(r.headline.confidence).toBe("low");
  });
});
