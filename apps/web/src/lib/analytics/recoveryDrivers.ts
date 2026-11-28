/**
 * Recovery Drivers — which of the user's OWN habits most associate with their
 * recovery score (flag `RECOVERY_DRIVERS=1`).
 *
 * Pure computation over already-fetched, user-scoped rows. No I/O.
 *
 * Date pairing (all dates are local YYYY-MM-DD strings, compared as strings
 * and shifted with UTC arithmetic so DST never moves a day):
 *   - `recovery.date` is the WAKE day (recovery is created when sleep ends).
 *   - `sleep.date` is also the wake day (issue #440), so the night that
 *     produced recovery D is `sleep.date === D`.
 *   - `cycles.date` / `workouts.date` are the local START day. The day of
 *     activity before recovery D is therefore cycle/workouts dated D-1.
 *
 * Statistics: for every driver we compute Pearson r between the driver value
 * and the recovery score (for yes/no drivers this is the point-biserial r),
 * plus a plain-language effect: the mean recovery of the "high" group minus
 * the "low" group (top vs bottom third for continuous drivers). A driver is
 * only shown as a finding when it clears every gate below; otherwise it is
 * reported as "not enough data" or "no clear pattern". These are
 * associations, not causes — the card says so.
 */
import type { RecoveryRow } from "@/lib/db/recovery";
import type { SleepRow } from "@/lib/db/sleep";
import type { CycleRow } from "@/lib/db/strain";
import type { WorkoutRow } from "@/lib/db/workouts";
import { linearRegression } from "./bedtime";
import { shiftDate } from "@/lib/range";

/** Days of history the page reads when the flag is on (inclusive of today). */
export const RECOVERY_DRIVERS_LOOKBACK_DAYS = 120;
/** Minimum scored recovery days before the card shows anything but the empty state. */
export const MIN_PAIRED_DAYS = 21;
/** Minimum days with a usable value for a single driver. */
export const MIN_DRIVER_DAYS = 21;
/** Minimum days in each compared group (high vs low, yes vs no). */
export const MIN_GROUP_DAYS = 5;
/** |r| below this is never a finding. */
export const MIN_ABS_R = 0.2;
/** Group difference below this many recovery points is never a finding. */
export const MIN_EFFECT_POINTS = 3;
/** Rough two-sided p<0.05 for Pearson r: t = r·√(n−2)/√(1−r²) must reach this. */
export const MIN_T_STAT = 2;
/** Number of findings ranked on the card. */
export const TOP_N = 3;

export function isRecoveryDriversEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.RECOVERY_DRIVERS === "1";
}

export type DriverKey =
  | "sleep_duration"
  | "bedtime_regularity"
  | "prior_strain"
  | "workout_day"
  | "deep_share"
  | "weekend";

export type Strength = "weak" | "moderate" | "strong";

export type DriverFinding = {
  key: DriverKey;
  label: string;
  status: "finding";
  /** Plain-language comparison, e.g. "Nights of 7.6 h or more average +9 recovery vs 6.4 h or less". */
  summary: string;
  /** Signed: high/yes group minus low/no group, in recovery points (rounded to 1 dp). */
  effectPoints: number;
  correlation: number;
  strength: Strength;
  n: number;
  highMean: number;
  lowMean: number;
  highN: number;
  lowN: number;
};

export type DriverNonFinding = {
  key: DriverKey;
  label: string;
  status: "insufficient" | "no_pattern";
  /** Why it isn't a finding, in plain words. */
  reason: string;
  n: number;
};

export type DriverResult = DriverFinding | DriverNonFinding;

export type RecoveryDriversResult =
  | { status: "insufficient"; pairedDays: number; minDays: number }
  | {
      status: "ok";
      pairedDays: number;
      start: string;
      end: string;
      /** Findings ranked by |r| desc, at most TOP_N. */
      top: DriverFinding[];
      /** Every other driver (findings beyond TOP_N included), in a stable order. */
      others: DriverResult[];
    };

export type RecoveryDriversInput = {
  recovery: Pick<RecoveryRow, "date" | "recovery_score">[];
  sleep: Pick<SleepRow, "date" | "light_ms" | "deep_ms" | "rem_ms" | "start_local">[];
  cycles: Pick<CycleRow, "date" | "strain">[];
  workouts: Pick<WorkoutRow, "date">[];
};

type Sample = { x: number; y: number };

const finite = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (v: number) => Math.round(v * 10) / 10;

export function strengthLabel(absR: number): Strength | null {
  if (absR >= 0.5) return "strong";
  if (absR >= 0.3) return "moderate";
  if (absR >= MIN_ABS_R) return "weak";
  return null;
}

/** Value at quantile q (0..1) of a sorted array, linear interpolation. */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const DOW_UTC = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

function parseBedtimeHour(startLocal: string | null): number | null {
  if (!startLocal) return null;
  const m = startLocal.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]) + Number(m[2]) / 60;
  // Re-anchor at 18:00 so 23:30 and 00:30 are one hour apart, not 23.
  return (h - 18 + 24) % 24;
}

type Gate =
  | { ok: true; r: number; strength: Strength }
  | { ok: false; status: "insufficient" | "no_pattern"; reason: string };

function gate(samples: Sample[], highN: number, lowN: number, effect: number, groupNoun: string): Gate {
  const n = samples.length;
  if (n < MIN_DRIVER_DAYS) {
    return { ok: false, status: "insufficient", reason: `Only ${n} of ${MIN_DRIVER_DAYS} days needed` };
  }
  if (highN < MIN_GROUP_DAYS || lowN < MIN_GROUP_DAYS) {
    return {
      ok: false,
      status: "insufficient",
      reason: `Too few ${groupNoun} to compare (${Math.min(highN, lowN)} of ${MIN_GROUP_DAYS})`,
    };
  }
  const reg = linearRegression(samples);
  if (!reg) {
    return { ok: false, status: "no_pattern", reason: "Not enough variation to compare" };
  }
  const r = reg.correlation;
  const absR = Math.abs(r);
  const t = absR >= 1 ? Infinity : (absR * Math.sqrt(n - 2)) / Math.sqrt(1 - r * r);
  const strength = strengthLabel(absR);
  if (
    strength == null ||
    t < MIN_T_STAT ||
    Math.abs(effect) < MIN_EFFECT_POINTS ||
    Math.sign(effect) !== Math.sign(r)
  ) {
    return { ok: false, status: "no_pattern", reason: "No clear pattern yet" };
  }
  return { ok: true, r, strength };
}

const fmtPts = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}`;

type ContinuousSpec = {
  key: DriverKey;
  label: string;
  /** Format a threshold for the summary, e.g. 7.62 → "7.6 h". */
  fmt: (v: number) => string;
  /** Build "Nights of X or more" / "nights of Y or less" phrases. */
  highPhrase: (t: string) => string;
  lowPhrase: (t: string) => string;
};

function continuousDriver(spec: ContinuousSpec, samples: Sample[]): DriverResult {
  const n = samples.length;
  if (n < MIN_DRIVER_DAYS) {
    return { key: spec.key, label: spec.label, status: "insufficient", reason: `Only ${n} of ${MIN_DRIVER_DAYS} days needed`, n };
  }
  const xs = samples.map((s) => s.x).sort((a, b) => a - b);
  const lowCut = quantile(xs, 1 / 3);
  const highCut = quantile(xs, 2 / 3);
  // Equal cuts (heavily tied data) would put the same days in both groups.
  const high = highCut > lowCut ? samples.filter((s) => s.x >= highCut) : [];
  const low = highCut > lowCut ? samples.filter((s) => s.x <= lowCut) : [];
  const highMean = high.length ? mean(high.map((s) => s.y)) : 0;
  const lowMean = low.length ? mean(low.map((s) => s.y)) : 0;
  const effect = highMean - lowMean;
  const g = gate(samples, high.length, low.length, effect, "distinct days");
  if (!g.ok) return { key: spec.key, label: spec.label, status: g.status, reason: g.reason, n };
  return {
    key: spec.key,
    label: spec.label,
    status: "finding",
    summary: `${spec.highPhrase(spec.fmt(highCut))} average ${fmtPts(effect)} recovery vs ${spec.lowPhrase(spec.fmt(lowCut))}`,
    effectPoints: round1(effect),
    correlation: g.r,
    strength: g.strength,
    n,
    highMean: round1(highMean),
    lowMean: round1(lowMean),
    highN: high.length,
    lowN: low.length,
  };
}

type BinarySpec = {
  key: DriverKey;
  label: string;
  yesPhrase: string;
  noPhrase: string;
  groupNoun: string;
};

function binaryDriver(spec: BinarySpec, samples: Sample[]): DriverResult {
  const n = samples.length;
  const yes = samples.filter((s) => s.x === 1);
  const no = samples.filter((s) => s.x === 0);
  const yesMean = yes.length ? mean(yes.map((s) => s.y)) : 0;
  const noMean = no.length ? mean(no.map((s) => s.y)) : 0;
  const effect = yesMean - noMean;
  const g = gate(samples, yes.length, no.length, effect, spec.groupNoun);
  if (!g.ok) return { key: spec.key, label: spec.label, status: g.status, reason: g.reason, n };
  return {
    key: spec.key,
    label: spec.label,
    status: "finding",
    summary: `${spec.yesPhrase} average ${fmtPts(effect)} recovery vs ${spec.noPhrase}`,
    effectPoints: round1(effect),
    correlation: g.r,
    strength: g.strength,
    n,
    highMean: round1(yesMean),
    lowMean: round1(noMean),
    highN: yes.length,
    lowN: no.length,
  };
}

const DRIVER_ORDER: DriverKey[] = [
  "sleep_duration",
  "bedtime_regularity",
  "prior_strain",
  "workout_day",
  "deep_share",
  "weekend",
];

export function computeRecoveryDrivers(input: RecoveryDriversInput): RecoveryDriversResult {
  // One recovery per date (the table's PK is (user_id, date), but be defensive).
  const recoveryByDate = new Map<string, number>();
  for (const r of input.recovery) {
    if (finite(r.recovery_score)) recoveryByDate.set(r.date, r.recovery_score);
  }
  const dates = [...recoveryByDate.keys()].sort();
  const pairedDays = dates.length;
  if (pairedDays < MIN_PAIRED_DAYS) {
    return { status: "insufficient", pairedDays, minDays: MIN_PAIRED_DAYS };
  }

  const sleepByDate = new Map<string, RecoveryDriversInput["sleep"][number]>();
  for (const s of input.sleep) if (!sleepByDate.has(s.date)) sleepByDate.set(s.date, s);
  const strainByDate = new Map<string, number>();
  for (const c of input.cycles) if (finite(c.strain)) strainByDate.set(c.date, c.strain);
  const workoutDates = new Set(input.workouts.map((w) => w.date));
  // Only call a day a "rest day" inside the span where workout data exists at
  // all — before the first logged workout we simply don't know.
  const firstWorkout = [...workoutDates].sort()[0] ?? null;

  const sleepHours: Sample[] = [];
  const deepShare: Sample[] = [];
  const bedtimes: { date: string; bt: number; y: number }[] = [];
  const priorStrain: Sample[] = [];
  const workoutDay: Sample[] = [];
  const weekend: Sample[] = [];

  for (const date of dates) {
    const y = recoveryByDate.get(date)!;
    const prev = shiftDate(date, -1);

    const s = sleepByDate.get(date);
    if (s && finite(s.light_ms) && finite(s.deep_ms) && finite(s.rem_ms)) {
      const total = s.light_ms + s.deep_ms + s.rem_ms;
      if (total > 0) {
        sleepHours.push({ x: total / 3_600_000, y });
        deepShare.push({ x: (s.deep_ms / total) * 100, y });
      }
    }
    const bt = s ? parseBedtimeHour(s.start_local) : null;
    if (bt != null) bedtimes.push({ date, bt, y });

    const strain = strainByDate.get(prev);
    if (strain != null) priorStrain.push({ x: strain, y });

    // Workout/rest needs the prior day to have a cycle (the band was worn)
    // and to fall within the span covered by workout data.
    if (strainByDate.has(prev) && firstWorkout != null && prev >= firstWorkout) {
      workoutDay.push({ x: workoutDates.has(prev) ? 1 : 0, y });
    }

    const dow = DOW_UTC(date);
    weekend.push({ x: dow === 0 || dow === 6 ? 1 : 0, y });
  }

  // Bedtime regularity: minutes away from the user's own median bedtime.
  // Higher x = more irregular; the phrases flip so "high" reads naturally.
  const bedtimeOff: Sample[] = [];
  if (bedtimes.length > 0) {
    const sorted = bedtimes.map((b) => b.bt).sort((a, b) => a - b);
    const median = quantile(sorted, 0.5);
    for (const b of bedtimes) bedtimeOff.push({ x: Math.abs(b.bt - median) * 60, y: b.y });
  }

  const results: Record<DriverKey, DriverResult> = {
    sleep_duration: continuousDriver(
      {
        key: "sleep_duration",
        label: "Sleep duration",
        fmt: (v) => `${v.toFixed(1)} h`,
        highPhrase: (t) => `Nights of ${t} or more`,
        lowPhrase: (t) => `${t} or less`,
      },
      sleepHours,
    ),
    bedtime_regularity: continuousDriver(
      {
        key: "bedtime_regularity",
        label: "Bedtime regularity",
        fmt: (v) => `${Math.round(v)} min`,
        highPhrase: (t) => `Bedtimes ${t}+ off your usual`,
        lowPhrase: (t) => `within ${t}`,
      },
      bedtimeOff,
    ),
    prior_strain: continuousDriver(
      {
        key: "prior_strain",
        label: "Previous day's strain",
        fmt: (v) => v.toFixed(1),
        highPhrase: (t) => `Days after strain of ${t} or more`,
        lowPhrase: (t) => `${t} or less`,
      },
      priorStrain,
    ),
    workout_day: binaryDriver(
      {
        key: "workout_day",
        label: "Workout vs rest day",
        yesPhrase: "Mornings after a workout day",
        noPhrase: "after a rest day",
        groupNoun: "workout or rest days",
      },
      workoutDay,
    ),
    deep_share: continuousDriver(
      {
        key: "deep_share",
        label: "Deep-sleep share",
        fmt: (v) => `${Math.round(v)}%`,
        highPhrase: (t) => `Nights with ${t}+ deep sleep`,
        lowPhrase: (t) => `${t} or less`,
      },
      deepShare,
    ),
    weekend: binaryDriver(
      {
        key: "weekend",
        label: "Day of week",
        yesPhrase: "Saturday & Sunday mornings",
        noPhrase: "weekdays",
        groupNoun: "weekend or weekday mornings",
      },
      weekend,
    ),
  };

  const findings = DRIVER_ORDER.map((k) => results[k])
    .filter((r): r is DriverFinding => r.status === "finding")
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  const top = findings.slice(0, TOP_N);
  const topKeys = new Set(top.map((t) => t.key));
  const others = DRIVER_ORDER.filter((k) => !topKeys.has(k)).map((k) => results[k]);

  return { status: "ok", pairedDays, start: dates[0], end: dates[dates.length - 1], top, others };
}
