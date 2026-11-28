/**
 * Compare two date ranges ("Period A" vs "Period B") across the core Whoop
 * metrics. Pure: no DB, no clock, no network. The /compare page reads the
 * rows through the existing user-scoped readers and hands them in here.
 *
 * Conventions:
 * - Period A is the one being judged ("this month"), Period B the baseline
 *   ("last month"). Change = A − B.
 * - All date math is on ISO calendar dates in UTC (`T00:00:00Z`), so the
 *   runtime timezone and DST transitions never shift a day.
 * - Daily metrics are averaged over the days that actually have a value
 *   ("days scored"); missing days and nulls are skipped, not counted as 0.
 * - Workouts are compared as per-week rates, so periods of different length
 *   compare fairly (a 27-day month-to-date vs a 31-day month).
 */

export const MAX_PERIOD_DAYS = 400;
const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// ─── Dates ────────────────────────────────────────────────────────────────

/** Strict `YYYY-MM-DD` check, including real calendar dates (no 2026-02-30). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  return new Date(toMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive count of calendar days from `from` to `to` (1 when equal). */
export function daysInclusive(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS) + 1;
}

/** Every ISO date from `from` to `to`, inclusive. */
export function enumerateDates(from: string, to: string): string[] {
  const n = daysInclusive(from, to);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(addDays(from, i));
  return out;
}

function ymd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ─── Ranges, presets, validation ──────────────────────────────────────────

export type Period = { from: string; to: string; days: number };

export type PresetKey = "month" | "30d" | "year";

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "month", label: "This month vs last month" },
  { key: "30d", label: "Last 30 days vs the 30 before" },
  { key: "year", label: "This year vs last year" },
];

export const DEFAULT_PRESET: PresetKey = "30d";

function period(from: string, to: string): Period {
  return { from, to, days: daysInclusive(from, to) };
}

/**
 * Resolve a preset against `today` (the user's local ISO date).
 * - month: month-to-date vs the whole previous calendar month.
 * - 30d:   the 30 days ending today vs the 30 days before those.
 * - year:  year-to-date vs the same calendar dates last year (Feb 29 → Feb 28).
 */
export function presetPeriods(preset: PresetKey, today: string): { a: Period; b: Period } {
  const [y, m, d] = today.split("-").map(Number);
  switch (preset) {
    case "month": {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return {
        a: period(ymd(y, m, 1), today),
        b: period(ymd(py, pm, 1), ymd(py, pm, daysInMonth(py, pm))),
      };
    }
    case "year": {
      const lastYearDay = Math.min(d, daysInMonth(y - 1, m));
      return {
        a: period(ymd(y, 1, 1), today),
        b: period(ymd(y - 1, 1, 1), ymd(y - 1, m, lastYearDay)),
      };
    }
    case "30d":
    default:
      return {
        a: period(addDays(today, -29), today),
        b: period(addDays(today, -59), addDays(today, -30)),
      };
  }
}

export type CompareParams = {
  preset?: string;
  a_from?: string;
  a_to?: string;
  b_from?: string;
  b_to?: string;
};

export type ResolvedComparison = {
  a: Period;
  b: Period;
  /** The preset in effect, or null for a custom range. */
  preset: PresetKey | null;
  /** Problems that forced a fallback to the default preset. */
  errors: string[];
  /** Adjustments and caveats the user should see (clamps, swaps, lengths). */
  notes: string[];
};

function isPreset(v: unknown): v is PresetKey {
  return v === "month" || v === "30d" || v === "year";
}

/**
 * Validate one user-supplied range: both ends real dates, from ≤ to (swapped
 * with a note otherwise), not entirely in the future, `to` clamped to today,
 * span clamped to MAX_PERIOD_DAYS (keeping the most recent end).
 */
function validateRange(
  name: string,
  from: string | undefined,
  to: string | undefined,
  today: string,
  notes: string[],
): Period | string {
  if (!isIsoDate(from) || !isIsoDate(to)) {
    return `${name}: dates must be real YYYY-MM-DD dates.`;
  }
  let f = from;
  let t = to;
  if (f > t) {
    [f, t] = [t, f];
    notes.push(`${name}: start was after end, so the dates were swapped.`);
  }
  if (f > today) {
    return `${name}: the range is entirely in the future.`;
  }
  if (t > today) {
    t = today;
    notes.push(`${name}: end moved back to today (${today}); future days have no data.`);
  }
  if (daysInclusive(f, t) > MAX_PERIOD_DAYS) {
    f = addDays(t, -(MAX_PERIOD_DAYS - 1));
    notes.push(`${name}: shortened to the last ${MAX_PERIOD_DAYS} days (from ${f}).`);
  }
  return period(f, t);
}

/**
 * Turn raw query params into two validated periods. Any custom date param
 * switches to custom mode, and all four must then be valid; otherwise the
 * page falls back to the preset (or the default) and lists the errors.
 */
export function resolveComparison(params: CompareParams, today: string): ResolvedComparison {
  const notes: string[] = [];
  const errors: string[] = [];
  const anyCustom = [params.a_from, params.a_to, params.b_from, params.b_to]
    .some((v) => typeof v === "string" && v !== "");
  const fallbackPreset = isPreset(params.preset) ? params.preset : DEFAULT_PRESET;

  let result: { a: Period; b: Period; preset: PresetKey | null } | null = null;

  if (anyCustom) {
    const a = validateRange("Period A", params.a_from, params.a_to, today, notes);
    const b = validateRange("Period B", params.b_from, params.b_to, today, notes);
    if (typeof a === "string") errors.push(a);
    if (typeof b === "string") errors.push(b);
    if (typeof a !== "string" && typeof b !== "string") {
      result = { a, b, preset: null };
    } else {
      // Clamp notes about a range we then discarded would only confuse.
      notes.length = 0;
    }
  }

  if (!result) {
    result = { ...presetPeriods(fallbackPreset, today), preset: fallbackPreset };
  }

  const { a, b } = result;
  if (a.days !== b.days) {
    notes.push(
      `The periods differ in length (${a.days} vs ${b.days} days). Daily metrics are averages and workouts are per-week rates, so they still compare fairly.`,
    );
  }
  if (a.from <= b.to && b.from <= a.to) {
    notes.push("The periods overlap, so shared days count toward both sides.");
  }

  return { ...result, errors, notes };
}

// ─── Metrics ──────────────────────────────────────────────────────────────

/** Which direction of change is good for the user. */
export type Better = "up" | "down" | "neither";

export type MetricKey =
  | "recovery"
  | "hrv"
  | "rhr"
  | "sleep_hours"
  | "sleep_performance"
  | "sleep_consistency"
  | "strain"
  | "workouts_per_week"
  | "workout_minutes_per_week";

export type MetricDef = {
  key: MetricKey;
  label: string;
  unit: string;
  better: Better;
  /** |change| below this reads as "about the same". */
  threshold: number;
  decimals: number;
};

export const METRICS: MetricDef[] = [
  { key: "recovery", label: "Recovery", unit: "%", better: "up", threshold: 3, decimals: 0 },
  { key: "hrv", label: "HRV", unit: "ms", better: "up", threshold: 3, decimals: 0 },
  { key: "rhr", label: "Resting HR", unit: "bpm", better: "down", threshold: 1, decimals: 1 },
  { key: "sleep_hours", label: "Sleep duration", unit: "h", better: "up", threshold: 0.25, decimals: 1 },
  { key: "sleep_performance", label: "Sleep performance", unit: "%", better: "up", threshold: 3, decimals: 0 },
  { key: "sleep_consistency", label: "Sleep consistency", unit: "%", better: "up", threshold: 3, decimals: 0 },
  { key: "strain", label: "Day strain", unit: "", better: "neither", threshold: 0.5, decimals: 1 },
  { key: "workouts_per_week", label: "Workouts", unit: "/wk", better: "up", threshold: 0.5, decimals: 1 },
  { key: "workout_minutes_per_week", label: "Workout time", unit: "min/wk", better: "up", threshold: 15, decimals: 0 },
];

// Minimal row shapes — structurally compatible with the @/lib/db row types.
export type RecoveryInput = { date: string; recovery_score: number | null; hrv: number | null; rhr: number | null };
export type SleepInput = {
  date: string;
  light_ms: number | null;
  deep_ms: number | null;
  rem_ms: number | null;
  performance: number | null;
  consistency: number | null;
};
export type CycleInput = { date: string; strain: number | null };
export type WorkoutInput = { date: string; duration_sec: number | null };

export type PeriodData = {
  recovery: RecoveryInput[];
  sleep: SleepInput[];
  cycles: CycleInput[];
  workouts: WorkoutInput[];
};

export type Verdict = "better" | "worse" | "same" | "changed" | "no-data";

export type SideStat = {
  /** Mean over scored days (or per-week rate for workouts); null with no data. */
  value: number | null;
  /** Days that contributed a value (for workouts: days with any Whoop data). */
  scoredDays: number;
  /** One entry per calendar day of the period, null where there's no value. */
  series: (number | null)[];
};

export type MetricComparison = {
  def: MetricDef;
  a: SideStat;
  b: SideStat;
  /** A − B, null when either side has no data. */
  change: number | null;
  /** Change relative to B, null when B is 0 or missing. */
  changePct: number | null;
  direction: "up" | "down" | "flat" | null;
  verdict: Verdict;
};

function finite(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function sleepHours(s: SleepInput): number | null {
  const l = finite(s.light_ms);
  const d = finite(s.deep_ms);
  const r = finite(s.rem_ms);
  if (l == null || d == null || r == null) return null;
  const total = l + d + r;
  return total > 0 ? total / 3_600_000 : null;
}

/** Daily series aligned to `dates`; duplicate dates keep the first value. */
function dailySeries<T extends { date: string }>(
  dates: string[],
  rows: T[],
  pick: (row: T) => number | null,
): (number | null)[] {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    if (byDate.has(row.date)) continue;
    const v = finite(pick(row));
    if (v != null) byDate.set(row.date, v);
  }
  return dates.map((d) => byDate.get(d) ?? null);
}

function meanStat(series: (number | null)[]): SideStat {
  const vals = series.filter((v): v is number => v != null);
  return {
    value: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null,
    scoredDays: vals.length,
    series,
  };
}

/**
 * Per-week workout rates. "Covered" days are days with any Whoop record
 * (recovery, sleep, cycle or workout); with zero covered days the rate is
 * unknown rather than 0, so a period before the strap was worn doesn't read
 * as "0 workouts". The rate divides by the full period length, matching the
 * plain reading of "workouts per week over this range".
 */
function workoutStats(dates: string[], data: PeriodData): { count: SideStat; minutes: SideStat } {
  const inPeriod = new Set(dates);
  const covered = new Set<string>();
  for (const list of [data.recovery, data.sleep, data.cycles, data.workouts]) {
    for (const r of list) if (inPeriod.has(r.date)) covered.add(r.date);
  }
  const countBy = new Map<string, number>();
  const minBy = new Map<string, number>();
  for (const w of data.workouts) {
    if (!inPeriod.has(w.date)) continue;
    countBy.set(w.date, (countBy.get(w.date) ?? 0) + 1);
    const sec = finite(w.duration_sec);
    if (sec != null && sec > 0) minBy.set(w.date, (minBy.get(w.date) ?? 0) + sec / 60);
  }
  const countSeries = dates.map((d) => (covered.has(d) ? countBy.get(d) ?? 0 : null));
  const minSeries = dates.map((d) => (covered.has(d) ? minBy.get(d) ?? 0 : null));
  const weeks = dates.length / 7;
  const rate = (series: (number | null)[]) =>
    covered.size === 0 ? null : series.reduce<number>((s, v) => s + (v ?? 0), 0) / weeks;
  return {
    count: { value: rate(countSeries), scoredDays: covered.size, series: countSeries },
    minutes: { value: rate(minSeries), scoredDays: covered.size, series: minSeries },
  };
}

function sideStats(p: Period, data: PeriodData): Record<MetricKey, SideStat> {
  const dates = enumerateDates(p.from, p.to);
  const w = workoutStats(dates, data);
  return {
    recovery: meanStat(dailySeries(dates, data.recovery, (r) => r.recovery_score)),
    hrv: meanStat(dailySeries(dates, data.recovery, (r) => r.hrv)),
    rhr: meanStat(dailySeries(dates, data.recovery, (r) => r.rhr)),
    sleep_hours: meanStat(dailySeries(dates, data.sleep, sleepHours)),
    sleep_performance: meanStat(dailySeries(dates, data.sleep, (s) => s.performance)),
    sleep_consistency: meanStat(dailySeries(dates, data.sleep, (s) => s.consistency)),
    strain: meanStat(dailySeries(dates, data.cycles, (c) => c.strain)),
    workouts_per_week: w.count,
    workout_minutes_per_week: w.minutes,
  };
}

/** Judge one change against the metric's noise threshold and good direction. */
export function judgeChange(
  def: Pick<MetricDef, "better" | "threshold">,
  change: number | null,
): { direction: "up" | "down" | "flat" | null; verdict: Verdict } {
  if (change == null) return { direction: null, verdict: "no-data" };
  if (Math.abs(change) < def.threshold) return { direction: "flat", verdict: "same" };
  const direction = change > 0 ? "up" : "down";
  if (def.better === "neither") return { direction, verdict: "changed" };
  return { direction, verdict: direction === def.better ? "better" : "worse" };
}

export function comparePeriods(
  a: Period,
  b: Period,
  dataA: PeriodData,
  dataB: PeriodData,
): MetricComparison[] {
  const sa = sideStats(a, dataA);
  const sb = sideStats(b, dataB);
  return METRICS.map((def) => {
    const A = sa[def.key];
    const B = sb[def.key];
    const change = A.value != null && B.value != null ? A.value - B.value : null;
    const changePct = change != null && B.value ? (change / Math.abs(B.value)) * 100 : null;
    return { def, a: A, b: B, change, changePct, ...judgeChange(def, change) };
  });
}

// ─── Sparkline geometry ───────────────────────────────────────────────────

/**
 * SVG path data for a paired sparkline: both series share one y-scale (so
 * levels are comparable) and each stretches across the full width (so a
 * 30-day and a 31-day period line up). Gaps (null days) break the line.
 * Returns empty strings for a series with no values.
 */
export function sparklinePaths(
  seriesA: (number | null)[],
  seriesB: (number | null)[],
  width: number,
  height: number,
  pad = 2,
): { a: string; b: string } {
  const vals = [...seriesA, ...seriesB].filter((v): v is number => v != null);
  if (vals.length === 0) return { a: "", b: "" };
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (height - 2 * pad);
  const path = (series: (number | null)[]) => {
    const n = series.length;
    const x = (i: number) => (n <= 1 ? width / 2 : pad + (i / (n - 1)) * (width - 2 * pad));
    let d = "";
    let pen = false;
    series.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      const cmd = pen ? "L" : "M";
      d += `${d ? " " : ""}${cmd}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      // A lone point between gaps still needs a visible mark.
      const next = series[i + 1];
      if (!pen && (next == null || i === n - 1)) d += ` h0.01`;
      pen = true;
    });
    return d;
  };
  return { a: path(seriesA), b: path(seriesB) };
}

// ─── Formatting ───────────────────────────────────────────────────────────

export function formatValue(def: MetricDef, v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(def.decimals);
}

export function formatChange(def: MetricDef, change: number | null): string {
  if (change == null) return "—";
  const fixed = Math.abs(change).toFixed(def.decimals);
  if (Number(fixed) === 0) return `±${fixed}`;
  return `${change > 0 ? "+" : "−"}${fixed}`;
}

export function formatRange(p: Period): string {
  return p.from === p.to ? p.from : `${p.from} → ${p.to}`;
}
