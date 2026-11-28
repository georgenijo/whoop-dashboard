// Weekly review (WEEKLY_REVIEW=1). Pure computation over rows the page has
// already read through the user-scoped `@/lib/db` readers — no DB, network or
// clock access here, so every edge case is unit-testable with fixtures.
//
// Windows are inclusive calendar dates keyed on the same `date` column every
// other page uses (wake day for sleep/recovery, user-local day for cycles and
// workouts): "this week" is `today` plus the six dates before it, "last week"
// is the seven dates before that.

import type { RecoveryRow } from "@/lib/db/recovery";
import type { SleepRow } from "@/lib/db/sleep";
import type { CycleRow } from "@/lib/db/strain";
import type { WorkoutRow } from "@/lib/db/workouts";
import { computeBedtimePatterns } from "./bedtime";

/** A week needs at least this many scored recovery days to be compared. */
export const MIN_SCORED_DAYS = 4;
/** Nights asleep for less than this many hours count as short. */
export const SHORT_NIGHT_HOURS = 7;
/** Bed/wake spread (std dev, minutes) above which consistency is called out. */
export const LOOSE_SCHEDULE_MIN = 60;

export type MetricKey =
  | "recovery"
  | "hrv"
  | "rhr"
  | "sleepHours"
  | "sleepPerformance"
  | "sleepEfficiency"
  | "strain";

type MetricSpec = {
  key: MetricKey;
  label: string;
  unit: string;
  /** Smallest absolute week-over-week change reported as a trend. */
  threshold: number;
  /** Which direction is good. `null` = neither (strain is load, not quality). */
  higherIsBetter: boolean | null;
  decimals: number;
};

export const METRIC_SPECS: readonly MetricSpec[] = [
  { key: "recovery", label: "Recovery", unit: "%", threshold: 5, higherIsBetter: true, decimals: 0 },
  { key: "hrv", label: "HRV", unit: "ms", threshold: 3, higherIsBetter: true, decimals: 0 },
  { key: "rhr", label: "Resting HR", unit: "bpm", threshold: 2, higherIsBetter: false, decimals: 0 },
  { key: "sleepHours", label: "Sleep duration", unit: "h", threshold: 1 / 3, higherIsBetter: true, decimals: 1 },
  { key: "sleepPerformance", label: "Sleep performance", unit: "%", threshold: 3, higherIsBetter: true, decimals: 0 },
  { key: "sleepEfficiency", label: "Sleep efficiency", unit: "%", threshold: 2, higherIsBetter: true, decimals: 0 },
  { key: "strain", label: "Day strain", unit: "", threshold: 1, higherIsBetter: null, decimals: 1 },
];

export type Direction = "up" | "down" | "flat";
export type Tone = "good" | "bad" | "neutral";

export type MetricComparison = {
  key: MetricKey;
  label: string;
  unit: string;
  decimals: number;
  current: number | null;
  previous: number | null;
  currentN: number;
  previousN: number;
  /** current − previous; null when either week lacks enough values. */
  delta: number | null;
  direction: Direction | null;
  tone: Tone | null;
};

export type DayValue = { date: string; value: number };

export type WeekWindow = { start: string; end: string };

export type WeeklyReview = {
  current: WeekWindow;
  previous: WeekWindow;
  currentScoredDays: number;
  previousScoredDays: number;
  /** Both weeks have >= MIN_SCORED_DAYS scored recovery days. */
  comparable: boolean;
  /** Current week has no recovery, sleep, strain or workout rows at all. */
  empty: boolean;
  metrics: MetricComparison[];
  bestRecovery: DayValue | null;
  worstRecovery: DayValue | null;
  shortNights: number;
  sleepNights: number;
  consistency: { bedtimeStdMin: number; wakeStdMin: number; nights: number } | null;
  workouts: { count: number; totalMin: number; zone2Min: number | null };
  highlights: string[];
};

export type WeeklyInput = {
  today: string;
  recovery: RecoveryRow[];
  sleep: SleepRow[];
  cycles: CycleRow[];
  workouts: WorkoutRow[];
};

/** Shift a `YYYY-MM-DD` date without involving the runtime timezone. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekWindows(today: string): { current: WeekWindow; previous: WeekWindow } {
  return {
    current: { start: addDays(today, -6), end: today },
    previous: { start: addDays(today, -13), end: addDays(today, -7) },
  };
}

function inWindow(date: string, w: WeekWindow): boolean {
  return date >= w.start && date <= w.end;
}

function isNum(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Hours actually asleep: staged sleep when present, else in-bed minus awake. */
export function asleepHours(row: SleepRow): number | null {
  const staged = [row.light_ms, row.deep_ms, row.rem_ms];
  if (staged.every(isNum)) {
    const total = (staged as number[]).reduce((a, b) => a + b, 0);
    if (total > 0) return total / 3_600_000;
  }
  if (isNum(row.in_bed_ms) && row.in_bed_ms > 0) {
    return (row.in_bed_ms - (isNum(row.awake_ms) ? row.awake_ms : 0)) / 3_600_000;
  }
  return null;
}

type WeekValues = Record<MetricKey, number[]>;

function collect(
  w: WeekWindow,
  recovery: RecoveryRow[],
  sleep: SleepRow[],
  cycles: CycleRow[],
): WeekValues {
  const out: WeekValues = {
    recovery: [],
    hrv: [],
    rhr: [],
    sleepHours: [],
    sleepPerformance: [],
    sleepEfficiency: [],
    strain: [],
  };
  for (const r of recovery) {
    if (!inWindow(r.date, w)) continue;
    if (isNum(r.recovery_score)) out.recovery.push(r.recovery_score);
    if (isNum(r.hrv)) out.hrv.push(r.hrv);
    if (isNum(r.rhr)) out.rhr.push(r.rhr);
  }
  for (const s of sleep) {
    if (!inWindow(s.date, w)) continue;
    const h = asleepHours(s);
    if (isNum(h)) out.sleepHours.push(h);
    if (isNum(s.performance)) out.sleepPerformance.push(s.performance);
    if (isNum(s.efficiency)) out.sleepEfficiency.push(s.efficiency);
  }
  for (const c of cycles) {
    if (!inWindow(c.date, w)) continue;
    if (isNum(c.strain)) out.strain.push(c.strain);
  }
  return out;
}

export function compareMetric(
  spec: MetricSpec,
  current: number[],
  previous: number[],
  comparable: boolean,
): MetricComparison {
  const cur = mean(current);
  const prev = mean(previous);
  const enough =
    comparable && current.length >= MIN_SCORED_DAYS && previous.length >= MIN_SCORED_DAYS;
  let delta: number | null = null;
  let direction: Direction | null = null;
  let tone: Tone | null = null;
  if (enough && cur != null && prev != null) {
    delta = cur - prev;
    // Changes below the metric's threshold are noise, not a trend. The
    // epsilon keeps a change of exactly the threshold (e.g. 20 min of sleep,
    // 1/3 h in floating point) from flipping on rounding error.
    if (Math.abs(delta) + 1e-9 < spec.threshold) {
      direction = "flat";
      tone = "neutral";
    } else {
      direction = delta > 0 ? "up" : "down";
      if (spec.higherIsBetter == null) tone = "neutral";
      else tone = (delta > 0) === spec.higherIsBetter ? "good" : "bad";
    }
  }
  return {
    key: spec.key,
    label: spec.label,
    unit: spec.unit,
    decimals: spec.decimals,
    current: cur,
    previous: prev,
    currentN: current.length,
    previousN: previous.length,
    delta,
    direction,
    tone,
  };
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** "Tue, Nov 25" — formatted from the calendar date itself, not a clock. */
export function formatDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatHoursMinutes(totalMin: number): string {
  const m = Math.round(totalMin);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

function changeSentence(m: MetricComparison): string | null {
  if (m.delta == null || m.direction == null || m.direction === "flat") return null;
  const abs = Math.abs(m.delta);
  const amount =
    m.key === "sleepHours"
      ? formatHoursMinutes(abs * 60)
      : `${round(abs, m.decimals)}${m.unit === "%" ? " points" : m.unit ? ` ${m.unit}` : ""}`;
  const verb = m.direction === "up" ? "up" : "down";
  const subject =
    m.key === "sleepHours" ? "Average sleep" : m.key === "strain" ? "Average day strain" : m.label;
  return `${subject} is ${verb} ${amount} vs last week`;
}

export function buildHighlights(r: Omit<WeeklyReview, "highlights">): string[] {
  if (r.empty) return [];
  const out: string[] = [];
  const byKey = new Map(r.metrics.map((m) => [m.key, m]));
  const push = (s: string | null) => {
    if (s && out.length < 4) out.push(s);
  };

  for (const key of ["hrv", "recovery", "rhr", "sleepHours"] as const) {
    push(changeSentence(byKey.get(key)!));
  }
  if (r.shortNights >= 2) {
    push(`You slept under ${SHORT_NIGHT_HOURS} h on ${r.shortNights} of ${r.sleepNights} nights`);
  }
  if (r.consistency && r.consistency.bedtimeStdMin >= LOOSE_SCHEDULE_MIN) {
    push(`Bedtime varied by about ±${Math.round(r.consistency.bedtimeStdMin)} min night to night`);
  }
  if (r.workouts.count > 0) {
    const z2 =
      r.workouts.zone2Min != null && r.workouts.zone2Min > 0
        ? `, ${Math.round(r.workouts.zone2Min)} min in zone 2`
        : "";
    push(
      `${r.workouts.count} workout${r.workouts.count === 1 ? "" : "s"} for ${formatHoursMinutes(r.workouts.totalMin)}${z2}`,
    );
  }
  if (out.length < 2 && r.bestRecovery) {
    push(`Best recovery was ${Math.round(r.bestRecovery.value)}% on ${formatDay(r.bestRecovery.date)}`);
  }
  if (out.length < 2) {
    const rec = byKey.get("recovery");
    if (rec?.direction === "flat") push("Recovery held steady vs last week");
    else if (rec?.current != null) push(`Average recovery this week was ${Math.round(rec.current)}%`);
  }
  return out;
}

export function computeWeeklyReview(input: WeeklyInput): WeeklyReview {
  const { current, previous } = weekWindows(input.today);
  const cur = collect(current, input.recovery, input.sleep, input.cycles);
  const prev = collect(previous, input.recovery, input.sleep, input.cycles);

  const currentScoredDays = cur.recovery.length;
  const previousScoredDays = prev.recovery.length;
  const comparable =
    currentScoredDays >= MIN_SCORED_DAYS && previousScoredDays >= MIN_SCORED_DAYS;

  const metrics = METRIC_SPECS.map((spec) =>
    compareMetric(spec, cur[spec.key], prev[spec.key], comparable),
  );

  let bestRecovery: DayValue | null = null;
  let worstRecovery: DayValue | null = null;
  // Ascending-date order so ties resolve to the earliest day, independent of
  // the order the reader returned rows in.
  const recDays = input.recovery
    .filter((r) => inWindow(r.date, current) && isNum(r.recovery_score))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const r of recDays) {
    const v = r.recovery_score as number;
    if (!bestRecovery || v > bestRecovery.value) bestRecovery = { date: r.date, value: v };
    if (!worstRecovery || v < worstRecovery.value) worstRecovery = { date: r.date, value: v };
  }
  if (recDays.length < 2) worstRecovery = null;

  const curSleep = input.sleep.filter((s) => inWindow(s.date, current));
  const shortNights = cur.sleepHours.filter((h) => h < SHORT_NIGHT_HOURS).length;
  // Reuses the Sleep page's bedtime analytics (anchor-wrapped clock maths,
  // midnight-safe); it needs >= 5 valid nights, otherwise no spread is shown.
  const patterns = computeBedtimePatterns(curSleep);
  const consistency = patterns
    ? {
        bedtimeStdMin: patterns.bedtime_std_min,
        wakeStdMin: patterns.wake_std_min,
        nights: patterns.series.length,
      }
    : null;

  const curWorkouts = input.workouts.filter((w) => inWindow(w.date, current));
  let totalSec = 0;
  let zone2Ms = 0;
  let zone2Known = false;
  for (const w of curWorkouts) {
    if (isNum(w.duration_sec)) totalSec += w.duration_sec;
    if (isNum(w.zone_2_ms)) {
      zone2Ms += w.zone_2_ms;
      zone2Known = true;
    }
  }

  const empty =
    currentScoredDays === 0 &&
    curSleep.length === 0 &&
    cur.strain.length === 0 &&
    curWorkouts.length === 0;

  const base: Omit<WeeklyReview, "highlights"> = {
    current,
    previous,
    currentScoredDays,
    previousScoredDays,
    comparable,
    empty,
    metrics,
    bestRecovery,
    worstRecovery,
    shortNights,
    sleepNights: cur.sleepHours.length,
    consistency,
    workouts: {
      count: curWorkouts.length,
      totalMin: totalSec / 60,
      zone2Min: zone2Known ? zone2Ms / 60_000 : null,
    },
  };
  return { ...base, highlights: buildHighlights(base) };
}
