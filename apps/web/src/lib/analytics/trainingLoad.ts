/**
 * Acute:chronic training-load balance (ACWR) from daily Whoop strain.
 *
 * Pure: no DB, clock or network. Callers pass the day's rows and "today"
 * (`YYYY-MM-DD`, already resolved in the user's timezone).
 *
 * Formula (rolling averages, evaluated for a calendar day D):
 *
 *   acute(D)   = mean of daily strain over the 7 calendar days  [D-6,  D]
 *   chronic(D) = mean of daily strain over the 28 calendar days [D-27, D]
 *   ratio(D)   = acute(D) / chronic(D)
 *
 * Only days that have a finite, non-negative strain value count toward a mean
 * (a missing or null day is "no data", not a zero-strain day — Whoop writes a
 * cycle for every day the strap is worn, so a gap is usually an unworn strap).
 * A window needs a minimum number of days with data before it's trusted:
 *
 *   - history shorter than 28 calendar days  → "building baseline"
 *   - fewer than CHRONIC_MIN_DAYS in the 28d window, or fewer than
 *     ACUTE_MIN_DAYS in the 7d window → "sparse" (not enough data)
 *   - chronic mean of 0                     → "zero-baseline" (no ratio;
 *     never divides by zero)
 *
 * All date math is calendar-day arithmetic on `YYYY-MM-DD` via `Date.UTC`, so
 * a DST transition can never make a window 6 or 8 days long.
 */

export const ACUTE_DAYS = 7;
export const CHRONIC_DAYS = 28;
/** Minimum days with data in the 7-day window before the acute mean is used. */
export const ACUTE_MIN_DAYS = 4;
/** Minimum days with data in the 28-day window before the chronic mean is used. */
export const CHRONIC_MIN_DAYS = 14;
/** Chart length: 12 weeks. */
export const CHART_DAYS = 84;

/** Hypothetical strain for "what if tomorrow is a rest day". */
export const REST_DAY_STRAIN = 4;
/** Hypothetical strain for "what if tomorrow is a hard day". */
export const HARD_DAY_STRAIN = 16;

export type LoadZone = "undertrained" | "sweet-spot" | "caution" | "high";

/**
 * Zone thresholds — the single source for both the classifier and the chart
 * bands: undertrained < 0.8 ≤ sweet spot ≤ 1.3 < caution ≤ 1.5 < high.
 */
export const LOAD_ZONES: readonly {
  zone: LoadZone;
  label: string;
  min: number;
  max: number;
  color: string;
}[] = [
  { zone: "undertrained", label: "Undertrained", min: 0, max: 0.8, color: "#00aaff" },
  { zone: "sweet-spot", label: "Sweet spot", min: 0.8, max: 1.3, color: "#00d4aa" },
  { zone: "caution", label: "Caution", min: 1.3, max: 1.5, color: "#ffaa00" },
  { zone: "high", label: "High", min: 1.5, max: Infinity, color: "#ff3b3b" },
];

export type LoadStatus = "ok" | "building" | "sparse" | "zero-baseline" | "no-data";

export type DailyStrain = { date: string; strain: number | null };

export type LoadPoint = {
  date: string;
  acute: number | null;
  chronic: number | null;
  ratio: number | null;
  zone: LoadZone | null;
  status: LoadStatus;
  acuteDays: number;
  chronicDays: number;
};

export type LoadSummary = {
  today: string;
  current: LoadPoint;
  /** 12 weeks ending today, oldest first, one entry per calendar day. */
  series: LoadPoint[];
  /** Days of history (calendar span from first data day to today, inclusive). */
  historyDays: number;
  /** Days still needed before the 28-day baseline exists (0 once built). */
  baselineDaysRemaining: number;
  projection: {
    date: string;
    rest: LoadPoint;
    hard: LoadPoint;
    restStrain: number;
    hardStrain: number;
  };
  suggestion: string;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Day number since the epoch for a valid `YYYY-MM-DD`, else null. */
export function dayNumber(date: string): number | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return Math.round(ms / 86_400_000);
}

export function dateFromDayNumber(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

export function shiftDay(date: string, days: number): string {
  const n = dayNumber(date);
  if (n === null) throw new RangeError(`invalid date: ${date}`);
  return dateFromDayNumber(n + days);
}

export function classifyRatio(ratio: number): LoadZone {
  const [under, sweet, caution] = LOAD_ZONES;
  if (ratio < under.max) return "undertrained";
  if (ratio <= sweet.max) return "sweet-spot";
  if (ratio <= caution.max) return "caution";
  return "high";
}

export function zoneMeta(zone: LoadZone) {
  return LOAD_ZONES.find((z) => z.zone === zone)!;
}

/**
 * Collapse rows into day-number → strain, dropping invalid dates, null /
 * non-finite / negative strain, and anything after `lastDay`. If a date
 * appears more than once, the larger value wins (one strain per day).
 */
function indexByDay(rows: readonly DailyStrain[], lastDay: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of rows) {
    if (r.strain === null || typeof r.strain !== "number" || !Number.isFinite(r.strain) || r.strain < 0) continue;
    const n = dayNumber(r.date);
    if (n === null || n > lastDay) continue;
    const prev = out.get(n);
    if (prev === undefined || r.strain > prev) out.set(n, r.strain);
  }
  return out;
}

function windowMean(byDay: Map<number, number>, end: number, len: number): { mean: number | null; days: number } {
  let sum = 0;
  let days = 0;
  for (let n = end - len + 1; n <= end; n++) {
    const v = byDay.get(n);
    if (v !== undefined) {
      sum += v;
      days++;
    }
  }
  return { mean: days > 0 ? sum / days : null, days };
}

function pointFor(byDay: Map<number, number>, firstDay: number | null, day: number): LoadPoint {
  const date = dateFromDayNumber(day);
  const a = windowMean(byDay, day, ACUTE_DAYS);
  const c = windowMean(byDay, day, CHRONIC_DAYS);
  const base = { date, acute: a.mean, chronic: c.mean, acuteDays: a.days, chronicDays: c.days };
  if (firstDay === null || firstDay > day) {
    return { ...base, ratio: null, zone: null, status: "no-data" };
  }
  if (day - firstDay + 1 < CHRONIC_DAYS) {
    return { ...base, ratio: null, zone: null, status: "building" };
  }
  if (c.days < CHRONIC_MIN_DAYS || a.days < ACUTE_MIN_DAYS || a.mean === null || c.mean === null) {
    return { ...base, ratio: null, zone: null, status: "sparse" };
  }
  if (c.mean <= 0) {
    return { ...base, ratio: null, zone: null, status: "zero-baseline" };
  }
  const ratio = a.mean / c.mean;
  return { ...base, ratio, zone: classifyRatio(ratio), status: "ok" };
}

/** Ratio for one calendar day from raw rows (rows after `date` are ignored). */
export function loadOn(rows: readonly DailyStrain[], date: string): LoadPoint {
  const day = dayNumber(date);
  if (day === null) throw new RangeError(`invalid date: ${date}`);
  const byDay = indexByDay(rows, day);
  const firstDay = byDay.size ? Math.min(...byDay.keys()) : null;
  return pointFor(byDay, firstDay, day);
}

/**
 * Build the page model. Rows may be unsorted, have gaps, nulls, duplicates or
 * future dates (ignored). `today` must be a valid `YYYY-MM-DD`.
 */
export function buildLoadSummary(
  rows: readonly DailyStrain[],
  today: string,
  opts: { restStrain?: number; hardStrain?: number } = {},
): LoadSummary {
  const todayN = dayNumber(today);
  if (todayN === null) throw new RangeError(`invalid today: ${today}`);
  const restStrain = opts.restStrain ?? REST_DAY_STRAIN;
  const hardStrain = opts.hardStrain ?? HARD_DAY_STRAIN;

  const byDay = indexByDay(rows, todayN);
  const firstDay = byDay.size ? Math.min(...byDay.keys()) : null;

  const series: LoadPoint[] = [];
  for (let n = todayN - CHART_DAYS + 1; n <= todayN; n++) {
    series.push(pointFor(byDay, firstDay, n));
  }
  const current = series[series.length - 1];

  const tomorrowN = todayN + 1;
  const project = (strain: number): LoadPoint => {
    const next = new Map(byDay);
    next.set(tomorrowN, strain);
    return pointFor(next, firstDay ?? tomorrowN, tomorrowN);
  };
  const rest = project(restStrain);
  const hard = project(hardStrain);

  const historyDays = firstDay === null ? 0 : todayN - firstDay + 1;
  const baselineDaysRemaining = Math.max(0, CHRONIC_DAYS - historyDays);

  return {
    today,
    current,
    series,
    historyDays,
    baselineDaysRemaining,
    projection: { date: dateFromDayNumber(tomorrowN), rest, hard, restStrain, hardStrain },
    suggestion: suggest(current, rest, hard, baselineDaysRemaining),
  };
}

export function formatRatio(ratio: number | null): string {
  return ratio === null ? "—" : ratio.toFixed(2);
}

function projText(p: LoadPoint): string {
  return p.ratio === null ? "an unknown ratio" : `${formatRatio(p.ratio)} (${zoneMeta(p.zone!).label.toLowerCase()})`;
}

/** One plain-language line. Not medical advice; framed as a nudge. */
export function suggest(current: LoadPoint, rest: LoadPoint, hard: LoadPoint, baselineDaysRemaining: number): string {
  switch (current.status) {
    case "no-data":
      return "No strain data yet — sync Whoop to start building your training-load baseline.";
    case "building":
      return `Building your baseline — ${baselineDaysRemaining} more day${baselineDaysRemaining === 1 ? "" : "s"} of strain data until the ratio is meaningful.`;
    case "sparse":
      return "Not enough recent days with strain data to compare — wear the strap consistently for a few days.";
    case "zero-baseline":
      return "Your 28-day baseline is zero, so there's nothing to compare against yet — any activity will start the ratio.";
    case "ok":
      break;
  }
  switch (current.zone) {
    case "undertrained":
      return hard.zone === "sweet-spot"
        ? `Load is below your baseline — a hard day tomorrow would bring you to ${projText(hard)}.`
        : "Load is below your baseline — build back up gradually over the next few days.";
    case "sweet-spot":
      return hard.zone === "sweet-spot"
        ? `You're in the sweet spot with room to push — even a hard day keeps you at ${projText(hard)}.`
        : `You're in the sweet spot — a hard day would take you to ${projText(hard)}, so keep tomorrow moderate.`;
    case "caution":
      return `Load is climbing faster than your baseline — a rest day would bring you to ${projText(rest)}.`;
    case "high":
      return `Acute load spike — prioritise recovery; a rest day brings you to ${projText(rest)}.`;
    default:
      return "";
  }
}
