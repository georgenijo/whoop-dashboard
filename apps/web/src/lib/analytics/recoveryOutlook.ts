/**
 * Tomorrow's recovery outlook (flag `RECOVERY_OUTLOOK=1`).
 *
 * A transparent, rules-plus-statistics band for tomorrow's recovery built ONLY
 * from the user's own past days. It is not a model of Whoop's algorithm and
 * the card says so. Pure computation over already-fetched, user-scoped rows —
 * no I/O, no clock (the caller passes `today`).
 *
 * Date pairing (local YYYY-MM-DD strings, shifted with UTC arithmetic via
 * `shiftDate`, so DST never moves a day):
 *   - `recovery.date` is the WAKE day; the night that produced recovery D is
 *     `sleep.date === D` (issue #440); the day of activity before it is the
 *     cycle dated D-1.
 *   - Tomorrow's recovery (D = today + 1) therefore depends on today's strain
 *     (cycle dated today, still in progress) and tonight's sleep (unknown).
 *
 * The model:
 *   1. Every past day D with a recovery score becomes a sample tagged with its
 *      sleep-need-met bucket (night D) and its prior-day strain bucket (D-1).
 *   2. For each sleep scenario tonight (short / fair / met) we take the
 *      matching past days, most specific first:
 *        cell     sleep bucket × today's strain bucket, if n ≥ MIN_BUCKET_DAYS
 *        sleep    sleep bucket only, if n ≥ MIN_BUCKET_DAYS
 *        overall  every scored day (wider band)
 *      When today's strain is not synced yet, the cell level is skipped.
 *   3. The band is the 25th–75th percentile of those days' recovery (10th–90th
 *      for the overall fallback), centred on the median. Percentiles, not
 *      means, so one sick day cannot drag the band.
 *   4. The headline uses the user's usual sleep bucket (mode of the last 14
 *      nights; a tie goes to the bucket of the most recent night).
 *   5. Levers are robust (Theil–Sen median-of-pairwise) slopes of recovery on
 *      sleep hours, prior-day strain and sleep consistency, expressed for a
 *      concrete change ("+1 h of sleep"). A lever needs ≥ MIN_LEVER_DAYS days
 *      and a p10–p90 spread at least as wide as its step (no extrapolation).
 *      Top two by size are shown.
 */
import type { RecoveryRow } from "@/lib/db/recovery";
import type { SleepRow } from "@/lib/db/sleep";
import type { CycleRow } from "@/lib/db/strain";
import { shiftDate } from "@/lib/range";

/** Days of history the page reads (inclusive of today). */
export const RECOVERY_OUTLOOK_LOOKBACK_DAYS = 90;
/** Scored recovery days required before any band is shown. */
export const MIN_HISTORY_DAYS = 14;
/** Days required in a bucket before it is used instead of a wider fallback. */
export const MIN_BUCKET_DAYS = 5;
/** Days with both values required before a lever slope is estimated. */
export const MIN_LEVER_DAYS = 14;
/** A lever smaller than this many recovery points is not worth showing. */
export const MIN_LEVER_POINTS = 1;
/** Nights considered when picking the user's usual sleep bucket. */
export const USUAL_SLEEP_NIGHTS = 14;
/** Number of levers shown. */
export const TOP_LEVERS = 2;

export function isRecoveryOutlookEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.RECOVERY_OUTLOOK === "1";
}

/**
 * Sleep-need-met buckets, matching Whoop's own sleep-performance colours
 * (≥85 green, 70–84 yellow, <70 red). Lower bound inclusive.
 */
export const SLEEP_BUCKETS = [
  { id: "short", label: "Under 70% of sleep need", min: -Infinity, max: 70 },
  { id: "fair", label: "70–84% of sleep need", min: 70, max: 85 },
  { id: "met", label: "85%+ of sleep need", min: 85, max: Infinity },
] as const;
export type SleepBucketId = (typeof SLEEP_BUCKETS)[number]["id"];

/**
 * Day-strain buckets, matching Whoop's light (0–9) / moderate (10–13) /
 * high + all-out (14+) split. Lower bound inclusive. Non-overlapping on
 * purpose (unlike strainTarget's STRAIN_ZONES), because every day must land in
 * exactly one bucket.
 */
export const STRAIN_BUCKETS = [
  { id: "light", label: "Light strain (under 10)", min: -Infinity, max: 10 },
  { id: "moderate", label: "Moderate strain (10–13.9)", min: 10, max: 14 },
  { id: "high", label: "High strain (14+)", min: 14, max: Infinity },
] as const;
export type StrainBucketId = (typeof STRAIN_BUCKETS)[number]["id"];

export function sleepBucketFor(pct: number | null): SleepBucketId | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  for (const b of SLEEP_BUCKETS) if (pct >= b.min && pct < b.max) return b.id;
  return null;
}

export function strainBucketFor(strain: number | null): StrainBucketId | null {
  if (strain == null || !Number.isFinite(strain) || strain < 0) return null;
  for (const b of STRAIN_BUCKETS) if (strain >= b.min && strain < b.max) return b.id;
  return null;
}

const finite = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Hours actually asleep (light + deep + REM), or null if any stage is missing. */
export function asleepHours(s: SleepRow): number | null {
  if (!finite(s.light_ms) || !finite(s.deep_ms) || !finite(s.rem_ms)) return null;
  const ms = s.light_ms + s.deep_ms + s.rem_ms;
  return ms > 0 ? ms / 3_600_000 : null;
}

/**
 * Percent of sleep need met. Whoop's `performance` is exactly that; when it is
 * missing, fall back to asleep ÷ need. Null when neither is usable (never
 * divides by a zero or negative need).
 */
export function sleepNeedMetPct(s: SleepRow): number | null {
  if (finite(s.performance)) return s.performance;
  const hours = asleepHours(s);
  if (hours == null || !finite(s.sleep_need_ms) || s.sleep_need_ms <= 0) return null;
  return ((hours * 3_600_000) / s.sleep_need_ms) * 100;
}

/** Linear-interpolated percentile (p in [0,1]) of an ascending array. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Theil–Sen slope: the median of every pairwise slope. Robust to a few
 * outliers. Pairs with equal x are skipped; returns null when no pair has
 * distinct x (so it never divides by zero).
 */
export function theilSenSlope(points: { x: number; y: number }[]): number | null {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].x - points[i].x;
      if (dx === 0) continue;
      slopes.push((points[j].y - points[i].y) / dx);
    }
  }
  if (slopes.length === 0) return null;
  slopes.sort((a, b) => a - b);
  return percentile(slopes, 0.5);
}

export type Sample = {
  date: string;
  recovery: number;
  sleepPct: number | null;
  sleepBucket: SleepBucketId | null;
  sleepHours: number | null;
  consistency: number | null;
  priorStrain: number | null;
  strainBucket: StrainBucketId | null;
};

export type Basis = "cell" | "sleep" | "strain" | "overall";
export type Confidence = "low" | "medium" | "high";

export type OutlookBand = {
  low: number;
  high: number;
  median: number;
  /** Past days the band is built from. */
  n: number;
  basis: Basis;
  confidence: Confidence;
};

export type OutlookScenario = {
  sleep: SleepBucketId;
  label: string;
  band: OutlookBand;
};

export type LeverKey = "sleep_hours" | "strain" | "consistency";

export type OutlookLever = {
  key: LeverKey;
  /** e.g. "+1 h of sleep tonight" */
  change: string;
  /** Signed recovery points for that change, rounded to an integer. */
  points: number;
  /** Days with both values that the slope was estimated from. */
  n: number;
};

export type RecoveryOutlook =
  | { status: "insufficient"; scoredDays: number; minDays: number }
  | {
      status: "ok";
      today: string;
      targetDate: string;
      /** Today's strain so far (cycle dated today), null if not synced. */
      todayStrain: number | null;
      strainBucket: StrainBucketId | null;
      /** Sleep bucket the headline assumes (user's usual), null if no sleep data. */
      assumedSleep: SleepBucketId | null;
      headline: OutlookBand;
      scenarios: OutlookScenario[];
      levers: OutlookLever[];
      scoredDays: number;
      start: string;
      end: string;
    };

export type RecoveryOutlookInput = {
  today: string;
  recovery: RecoveryRow[];
  sleep: SleepRow[];
  cycles: CycleRow[];
};

/** Build one sample per scored recovery day (last row wins on duplicate dates). */
export function buildSamples(input: RecoveryOutlookInput): Sample[] {
  const sleepByDate = new Map(input.sleep.map((s) => [s.date, s]));
  const strainByDate = new Map(input.cycles.map((c) => [c.date, c.strain]));
  const byDate = new Map<string, Sample>();
  for (const r of input.recovery) {
    if (!finite(r.recovery_score) || r.date > input.today) continue;
    const recovery = Math.min(100, Math.max(0, r.recovery_score));
    const s = sleepByDate.get(r.date);
    const sleepPct = s ? sleepNeedMetPct(s) : null;
    const rawStrain = strainByDate.get(shiftDate(r.date, -1));
    const priorStrain = finite(rawStrain) && rawStrain >= 0 ? rawStrain : null;
    byDate.set(r.date, {
      date: r.date,
      recovery,
      sleepPct,
      sleepBucket: sleepBucketFor(sleepPct),
      sleepHours: s ? asleepHours(s) : null,
      consistency: s && finite(s.consistency) ? s.consistency : null,
      priorStrain,
      strainBucket: strainBucketFor(priorStrain),
    });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function confidenceFor(basis: Basis, n: number): Confidence {
  if (basis === "overall") return "low";
  if (basis === "cell" && n >= 20) return "high";
  if (n >= 10) return "medium";
  return "low";
}

function bandFrom(values: number[], basis: Basis): OutlookBand {
  const sorted = [...values].sort((a, b) => a - b);
  const wide = basis === "overall";
  return {
    low: Math.round(percentile(sorted, wide ? 0.1 : 0.25)),
    high: Math.round(percentile(sorted, wide ? 0.9 : 0.75)),
    median: Math.round(percentile(sorted, 0.5)),
    n: sorted.length,
    basis,
    confidence: confidenceFor(basis, sorted.length),
  };
}

/**
 * Most specific bucket with ≥ MIN_BUCKET_DAYS, falling back to every sample.
 * `samples` must be non-empty.
 */
export function bandFor(
  samples: Sample[],
  sleep: SleepBucketId | null,
  strain: StrainBucketId | null,
): OutlookBand {
  const pick = (pred: (s: Sample) => boolean) =>
    samples.filter(pred).map((s) => s.recovery);
  if (sleep && strain) {
    const cell = pick((s) => s.sleepBucket === sleep && s.strainBucket === strain);
    if (cell.length >= MIN_BUCKET_DAYS) return bandFrom(cell, "cell");
  }
  if (sleep) {
    const bySleep = pick((s) => s.sleepBucket === sleep);
    if (bySleep.length >= MIN_BUCKET_DAYS) return bandFrom(bySleep, "sleep");
  } else if (strain) {
    const byStrain = pick((s) => s.strainBucket === strain);
    if (byStrain.length >= MIN_BUCKET_DAYS) return bandFrom(byStrain, "strain");
  }
  return bandFrom(samples.map((s) => s.recovery), "overall");
}

/**
 * Mode sleep bucket over the most recent USUAL_SLEEP_NIGHTS nights that have
 * one. Ties go to the bucket of the most recent of those nights. Null when no
 * night has a usable sleep-need-met value.
 */
export function usualSleepBucket(samples: Sample[]): SleepBucketId | null {
  const recent = samples.filter((s) => s.sleepBucket != null).slice(-USUAL_SLEEP_NIGHTS);
  if (recent.length === 0) return null;
  const counts = new Map<SleepBucketId, number>();
  for (const s of recent) counts.set(s.sleepBucket!, (counts.get(s.sleepBucket!) ?? 0) + 1);
  const max = Math.max(...counts.values());
  for (let i = recent.length - 1; i >= 0; i--) {
    const b = recent[i].sleepBucket!;
    if (counts.get(b) === max) return b;
  }
  return null; // unreachable
}

const LEVERS: {
  key: LeverKey;
  change: string;
  delta: number;
  x: (s: Sample) => number | null;
}[] = [
  { key: "sleep_hours", change: "+1 h of sleep tonight", delta: 1, x: (s) => s.sleepHours },
  { key: "strain", change: "2 less strain today", delta: -2, x: (s) => s.priorStrain },
  { key: "consistency", change: "+10 pts sleep consistency", delta: 10, x: (s) => s.consistency },
];

export function computeLevers(samples: Sample[]): OutlookLever[] {
  const out: OutlookLever[] = [];
  for (const lever of LEVERS) {
    const points = samples.flatMap((s) => {
      const x = lever.x(s);
      return x != null && Number.isFinite(x) ? [{ x, y: s.recovery }] : [];
    });
    if (points.length < MIN_LEVER_DAYS) continue;
    // Only speak to a change the user has actually lived: the middle 80% of
    // their values must span at least the lever's step, or it is extrapolation.
    const xs = points.map((p) => p.x).sort((a, b) => a - b);
    if (percentile(xs, 0.9) - percentile(xs, 0.1) < Math.abs(lever.delta)) continue;
    const slope = theilSenSlope(points);
    if (slope == null) continue;
    const effect = slope * lever.delta;
    if (!Number.isFinite(effect) || Math.abs(effect) < MIN_LEVER_POINTS) continue;
    out.push({ key: lever.key, change: lever.change, points: Math.round(effect), n: points.length });
  }
  // Biggest absolute effect first; ties keep the declaration order above.
  return out
    .map((l, i) => ({ l, i }))
    .sort((a, b) => Math.abs(b.l.points) - Math.abs(a.l.points) || a.i - b.i)
    .slice(0, TOP_LEVERS)
    .map(({ l }) => l);
}

export function computeRecoveryOutlook(input: RecoveryOutlookInput): RecoveryOutlook {
  const samples = buildSamples(input);
  if (samples.length < MIN_HISTORY_DAYS) {
    return { status: "insufficient", scoredDays: samples.length, minDays: MIN_HISTORY_DAYS };
  }
  const todayCycle = input.cycles.filter((c) => c.date === input.today).pop();
  const todayStrain =
    todayCycle && finite(todayCycle.strain) && todayCycle.strain >= 0 ? todayCycle.strain : null;
  const strainBucket = strainBucketFor(todayStrain);
  const assumedSleep = usualSleepBucket(samples);
  return {
    status: "ok",
    today: input.today,
    targetDate: shiftDate(input.today, 1),
    todayStrain,
    strainBucket,
    assumedSleep,
    headline: bandFor(samples, assumedSleep, strainBucket),
    scenarios: SLEEP_BUCKETS.map((b) => ({
      sleep: b.id,
      label: b.label,
      band: bandFor(samples, b.id, strainBucket),
    })),
    levers: computeLevers(samples),
    scoredDays: samples.length,
    start: samples[0].date,
    end: samples[samples.length - 1].date,
  };
}
