// Personal-record history (RECORDS_PAGE=1, /records).
//
// Pure: no DB, no clock, no network. The caller hands in user-scoped rows
// (see `getRecordSeries` in lib/db/prs.ts) plus the user's local "today" as a
// YYYY-MM-DD string, so every date here is a calendar date, never an instant.
// Day arithmetic goes through Date.UTC on those calendar dates, so DST
// transitions in the user's zone can never make a day 23 or 25 hours long.

export type RecordDirection = "max" | "min";

/** One reading. `value` may be null/NaN (missing or unscored) and is skipped. */
export type MetricPoint = {
  date: string;
  value: number | null | undefined;
  /** Optional label carried with the reading (e.g. a workout's sport). */
  note?: string | null;
};

export type RecordEntry = {
  value: number;
  /** The day this value first became the record. */
  setOn: string;
  /** The most recent day that matched this value (== setOn unless tied). */
  lastMatchedOn: string;
  /** Days, after `setOn`, that equalled the record exactly. */
  ties: number;
  note: string | null;
};

export type RecordHistory = {
  /** The standing record, or null when there is no valid reading at all. */
  current: RecordEntry | null;
  /** Up to `historyCount` earlier records, newest first (the progression). */
  previous: RecordEntry[];
  /** Total number of times a new record was set, the first reading included. */
  recordCount: number;
  /**
   * Whole days between the most recent day the record was set or matched and
   * `today`. Clamped at 0 (a row dated "tomorrow" by a zone skew is today).
   */
  daysSinceRecord: number | null;
  /** Median of the readings in the `typicalWindowDays` ending `today`. */
  typical: number | null;
  typicalSamples: number;
  /** current - typical (raw units; sign is not direction-adjusted). */
  deltaVsTypical: number | null;
  /** (current - typical) / typical * 100, null when typical is 0 or missing. */
  deltaPctVsTypical: number | null;
  /** Distinct valid days that fed the history. */
  days: number;
  firstDate: string | null;
  lastDate: string | null;
};

export type RecordOptions = {
  /** The user's local calendar date (YYYY-MM-DD). */
  today: string;
  typicalWindowDays?: number;
  historyCount?: number;
};

export const TYPICAL_WINDOW_DAYS = 90;
export const RECORD_HISTORY_COUNT = 3;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Days since 1970-01-01 for a valid YYYY-MM-DD calendar date, else null. */
export function dayNumber(date: string): number | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // Reject rollovers such as 2026-02-30 → 2026-03-02.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return Math.round(ms / MS_PER_DAY);
}

function better(a: number, b: number, dir: RecordDirection): boolean {
  return dir === "max" ? a > b : a < b;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Collapse readings to one per calendar date — the best of that day in the
 * record's direction — dropping invalid dates and non-finite values. Sorted
 * oldest first. Several workouts or step cycles on one date compete; the
 * day's best is the one that can set a record.
 */
export function bestPerDay(
  points: readonly MetricPoint[],
  dir: RecordDirection,
): { date: string; day: number; value: number; note: string | null }[] {
  const byDate = new Map<string, { date: string; day: number; value: number; note: string | null }>();
  for (const p of points) {
    if (typeof p.value !== "number" || !Number.isFinite(p.value)) continue;
    const day = dayNumber(p.date);
    if (day === null) continue;
    const prev = byDate.get(p.date);
    if (!prev || better(p.value, prev.value, dir)) {
      byDate.set(p.date, { date: p.date, day, value: p.value, note: p.note ?? null });
    }
  }
  return [...byDate.values()].sort((a, b) => a.day - b.day);
}

/**
 * Walk a metric's history oldest → newest and record every time it was beaten.
 *
 * - The first valid reading is the first record (a first-day user has one
 *   record, no progression, and 0 days since it).
 * - A strictly better reading sets a new record; the old one moves into the
 *   progression.
 * - An exact tie does NOT set a new record. It bumps the standing record's
 *   `ties` and `lastMatchedOn`, and `daysSinceRecord` counts from that latest
 *   match — the same "most recent date wins a tie" rule `getBestHRV` /
 *   `getLowestRHR` use (`ORDER BY value, date DESC`), so the page and the
 *   Overview card never disagree on a record's date.
 * - Gaps (missing days) are simply absent; they neither break nor set records.
 */
export function buildRecordHistory(
  points: readonly MetricPoint[],
  dir: RecordDirection,
  opts: RecordOptions,
): RecordHistory {
  const windowDays = Math.max(1, Math.floor(opts.typicalWindowDays ?? TYPICAL_WINDOW_DAYS));
  const historyCount = Math.max(0, Math.floor(opts.historyCount ?? RECORD_HISTORY_COUNT));
  const todayN = dayNumber(opts.today);
  const days = bestPerDay(points, dir);

  const records: RecordEntry[] = [];
  for (const d of days) {
    const cur = records[records.length - 1];
    if (!cur || better(d.value, cur.value, dir)) {
      records.push({ value: d.value, setOn: d.date, lastMatchedOn: d.date, ties: 0, note: d.note });
    } else if (d.value === cur.value) {
      cur.ties += 1;
      cur.lastMatchedOn = d.date;
      cur.note = d.note ?? cur.note;
    }
  }

  const current = records[records.length - 1] ?? null;
  const previous = records.slice(0, -1).reverse().slice(0, historyCount);

  let daysSinceRecord: number | null = null;
  if (current && todayN !== null) {
    daysSinceRecord = Math.max(0, todayN - (dayNumber(current.lastMatchedOn) as number));
  }

  // Typical = median of the trailing window [today - (window-1), today].
  // Future-dated rows are excluded so a skewed row can't define "typical".
  const windowValues =
    todayN === null
      ? []
      : days.filter((d) => d.day <= todayN && d.day > todayN - windowDays).map((d) => d.value);
  const typical = median(windowValues);
  const deltaVsTypical = current && typical !== null ? current.value - typical : null;
  const deltaPctVsTypical =
    deltaVsTypical !== null && typical !== null && typical !== 0
      ? (deltaVsTypical / Math.abs(typical)) * 100
      : null;

  return {
    current,
    previous,
    recordCount: records.length,
    daysSinceRecord,
    typical,
    typicalSamples: windowValues.length,
    deltaVsTypical,
    deltaPctVsTypical,
    days: days.length,
    firstDate: days[0]?.date ?? null,
    lastDate: days[days.length - 1]?.date ?? null,
  };
}

export type RecordMetricKey =
  | "hrv"
  | "rhr"
  | "recovery"
  | "strain"
  | "sleepDuration"
  | "sleepPerformance"
  | "workoutDuration"
  | "steps";

export type RecordMetricDef = {
  key: RecordMetricKey;
  label: string;
  direction: RecordDirection;
};

/** Page order. `direction` is what "better" means for each metric. */
export const RECORD_METRICS: readonly RecordMetricDef[] = [
  { key: "hrv", label: "Best HRV", direction: "max" },
  { key: "rhr", label: "Lowest resting HR", direction: "min" },
  { key: "recovery", label: "Best recovery", direction: "max" },
  { key: "strain", label: "Highest day strain", direction: "max" },
  { key: "sleepDuration", label: "Longest sleep", direction: "max" },
  { key: "sleepPerformance", label: "Best sleep performance", direction: "max" },
  { key: "workoutDuration", label: "Longest workout", direction: "max" },
  { key: "steps", label: "Most steps", direction: "max" },
];

export type RecordSeries = Record<RecordMetricKey, MetricPoint[]>;

export type RecordBoardRow = RecordMetricDef & { history: RecordHistory };

export function buildRecordBoard(series: RecordSeries, opts: RecordOptions): RecordBoardRow[] {
  return RECORD_METRICS.map((m) => ({
    ...m,
    history: buildRecordHistory(series[m.key] ?? [], m.direction, opts),
  }));
}
