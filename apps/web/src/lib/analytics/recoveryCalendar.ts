// ---------------------------------------------------------------------------
// Recovery calendar (RECOVERY_CALENDAR=1)
//
// Builds a GitHub-style 53-week x 7-day heatmap of daily recovery from the
// user's own `getRecoveryRange` rows, plus the summary stats shown under it
// (green-day streaks, best/worst month, scored-day coverage).
//
// Pure: no DB, network, clock or locale access. Callers pass `today` as the
// user's local date (`localToday()`), and all arithmetic runs on YYYY-MM-DD
// strings through UTC midnights, so DST transitions can never add or drop a
// day and the server's timezone never shifts a cell.
// ---------------------------------------------------------------------------

import { recoveryBand, type Band } from "@/components/plans/band";

/** Server-side feature flag. Off unless exactly "1". */
export function isRecoveryCalendarEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.RECOVERY_CALENDAR === "1";
}

/** First day of each grid column: 0 = Sunday, 1 = Monday. Whoop is Monday-first. */
export const WEEK_START_DAY: 0 | 1 = 1;
/**
 * Columns in the grid. A 365-day window always fits 53 week columns. A 366-day
 * window (one spanning Feb 29) that ends on the first day of a week needs a
 * 54th, so the grid grows by one column in exactly that case rather than
 * silently dropping the oldest day.
 */
export const CALENDAR_WEEKS = 53;
/** A month needs this many scored days before it can be "best" or "worst". */
export const MIN_SCORED_DAYS_FOR_MONTH = 7;
/** Month labels closer than this many columns to the previous one are dropped. */
const MIN_LABEL_GAP_COLUMNS = 3;

export type CalendarInputRow = {
  date: string;
  recovery_score: number | null;
  hrv: number | null;
  rhr: number | null;
};

export type CalendarCell = {
  date: string;
  /** False for padding before the 12-month window or after today. */
  inWindow: boolean;
  score: number | null;
  hrv: number | null;
  rhr: number | null;
  band: Band | null;
  /** Human text for title/aria-label, e.g. "Mon, Nov 3, 2026: recovery 72% (High) · HRV 61 ms · RHR 52 bpm". */
  label: string;
};

export type MonthLabel = { column: number; label: string };

export type MonthSummary = {
  /** YYYY-MM */
  month: string;
  label: string;
  daysInWindow: number;
  scored: number;
  average: number | null;
  high: number;
  mid: number;
  low: number;
};

export type Streak = { length: number; start: string | null; end: string | null };

export type RecoveryCalendar = {
  today: string;
  windowStart: string;
  weekStartDay: 0 | 1;
  /** `weeks[column][row]`, row 0 = WEEK_START_DAY. 53 columns (54 in the leap case above). */
  weeks: CalendarCell[][];
  monthLabels: MonthLabel[];
  /** Row labels in grid order, e.g. ["Mon", ..., "Sun"]. */
  weekdayLabels: string[];
  daysInWindow: number;
  daysScored: number;
  /** 0–100, rounded. */
  coveragePct: number;
  bandCounts: Record<Band, number>;
  currentGreenStreak: Streak;
  longestGreenStreak: Streak;
  /** Present only when at least one month has MIN_SCORED_DAYS_FOR_MONTH scored days. */
  bestMonth: MonthSummary | null;
  /** Present only when at least two months qualify (otherwise it equals best). */
  worstMonth: MonthSummary | null;
  months: MonthSummary[];
  /** Scored days, oldest first — the text alternative's daily table. */
  scoredDays: CalendarCell[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
}

function weekday(date: string): number {
  return toUtc(date).getUTCDay();
}

/** Days between two dates (b - a). */
function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const d = toUtc(date);
  return !Number.isNaN(d.getTime()) && fmt(d) === date;
}

/**
 * First day of the trailing 12-month window ending on `today`: the day after
 * the same calendar date one year earlier. Feb 29 has no counterpart in the
 * previous year, so it clamps to Feb 28 (window starts Mar 1). The window is
 * therefore 365 days, or 366 when it spans a Feb 29.
 */
export function windowStartFor(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const prevYear = y - 1;
  const lastDay = new Date(Date.UTC(prevYear, m, 0)).getUTCDate();
  const anchor = fmt(new Date(Date.UTC(prevYear, m - 1, Math.min(d, lastDay))));
  return addDays(anchor, 1);
}

/** Start of the grid column containing `date`. */
export function startOfWeek(date: string, weekStartDay: 0 | 1 = WEEK_START_DAY): string {
  const offset = (weekday(date) - weekStartDay + 7) % 7;
  return addDays(date, -offset);
}

function longDate(date: string): string {
  const d = toUtc(date);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

const BAND_TEXT: Record<Band, string> = { high: "High", mid: "Mid", low: "Low" };

function finite(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function cellLabel(date: string, score: number | null, hrv: number | null, rhr: number | null, band: Band | null): string {
  const head = longDate(date);
  const parts: string[] = [];
  if (score != null && band) parts.push(`recovery ${Math.round(score)}% (${BAND_TEXT[band]})`);
  else parts.push("no recovery score");
  if (hrv != null) parts.push(`HRV ${Math.round(hrv)} ms`);
  if (rhr != null) parts.push(`RHR ${Math.round(rhr)} bpm`);
  return `${head}: ${parts.join(" · ")}`;
}

export function buildRecoveryCalendar(
  rows: readonly CalendarInputRow[],
  today: string,
  weekStartDay: 0 | 1 = WEEK_START_DAY,
): RecoveryCalendar {
  if (!isValidDate(today)) throw new Error(`buildRecoveryCalendar: invalid today ${today}`);

  const windowStart = windowStartFor(today);
  const gridEndWeek = startOfWeek(today, weekStartDay);
  const columns = Math.max(
    CALENDAR_WEEKS,
    diffDays(startOfWeek(windowStart, weekStartDay), gridEndWeek) / 7 + 1,
  );
  const gridStart = addDays(gridEndWeek, -7 * (columns - 1));

  // Index rows by date; ignore malformed or out-of-window dates. The DB PK
  // makes dates unique per user, but keep the last row if a caller repeats one.
  const byDate = new Map<string, CalendarInputRow>();
  for (const r of rows) {
    if (!r || typeof r.date !== "string" || !isValidDate(r.date)) continue;
    if (r.date < windowStart || r.date > today) continue;
    byDate.set(r.date, r);
  }

  const weeks: CalendarCell[][] = [];
  const scoredDays: CalendarCell[] = [];
  const bandCounts: Record<Band, number> = { high: 0, mid: 0, low: 0 };
  const monthMap = new Map<string, MonthSummary & { sum: number }>();

  for (let w = 0; w < columns; w++) {
    const col: CalendarCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(gridStart, w * 7 + d);
      const inWindow = date >= windowStart && date <= today;
      const row = inWindow ? byDate.get(date) : undefined;
      const score = finite(row?.recovery_score);
      const hrv = finite(row?.hrv);
      const rhr = finite(row?.rhr);
      const band = score != null ? recoveryBand(score) : null;
      const cell: CalendarCell = {
        date,
        inWindow,
        score,
        hrv,
        rhr,
        band,
        label: inWindow ? cellLabel(date, score, hrv, rhr, band) : "",
      };
      col.push(cell);
      if (!inWindow) continue;

      const mk = date.slice(0, 7);
      let m = monthMap.get(mk);
      if (!m) {
        m = { month: mk, label: monthLabel(mk), daysInWindow: 0, scored: 0, average: null, high: 0, mid: 0, low: 0, sum: 0 };
        monthMap.set(mk, m);
      }
      m.daysInWindow++;
      if (score != null && band) {
        scoredDays.push(cell);
        bandCounts[band]++;
        m.scored++;
        m.sum += score;
        m[band]++;
      }
    }
    weeks.push(col);
  }

  // Month labels: at the column holding the 1st of each month in the window,
  // plus the first column for the window's opening month when there is room.
  const monthLabels: MonthLabel[] = [];
  for (let w = 0; w < weeks.length; w++) {
    const first = weeks[w].find((c) => c.inWindow && c.date.endsWith("-01"));
    if (first) monthLabels.push({ column: w, label: MONTHS[Number(first.date.slice(5, 7)) - 1] });
  }
  const openingCol = Math.floor(diffDays(gridStart, windowStart) / 7);
  if (!windowStart.endsWith("-01") && (monthLabels.length === 0 || monthLabels[0].column - openingCol >= MIN_LABEL_GAP_COLUMNS)) {
    monthLabels.unshift({ column: openingCol, label: MONTHS[Number(windowStart.slice(5, 7)) - 1] });
  }

  const months: MonthSummary[] = [...monthMap.values()].map(({ sum, ...m }) => ({
    ...m,
    average: m.scored > 0 ? Math.round((sum / m.scored) * 10) / 10 : null,
  }));

  const qualifying = months.filter((m) => m.scored >= MIN_SCORED_DAYS_FOR_MONTH);
  let bestMonth: MonthSummary | null = null;
  let worstMonth: MonthSummary | null = null;
  for (const m of qualifying) {
    // Ties keep the more recent month: iteration is oldest-first and `>=` / `<=` replace.
    if (!bestMonth || (m.average as number) >= (bestMonth.average as number)) bestMonth = m;
    if (!worstMonth || (m.average as number) <= (worstMonth.average as number)) worstMonth = m;
  }
  if (qualifying.length < 2) worstMonth = null;

  // Green streaks over consecutive calendar days; a missing day breaks a run.
  let longest: Streak = { length: 0, start: null, end: null };
  let runStart: string | null = null;
  let runLen = 0;
  for (let date = windowStart; date <= today; date = addDays(date, 1)) {
    const score = finite(byDate.get(date)?.recovery_score);
    if (score != null && recoveryBand(score) === "high") {
      if (runLen === 0) runStart = date;
      runLen++;
      if (runLen > longest.length) longest = { length: runLen, start: runStart, end: date };
    } else {
      runLen = 0;
      runStart = null;
    }
  }

  // Current streak: counts back from today; if today has no score yet (the
  // morning recovery hasn't synced), count back from yesterday instead so an
  // unsynced morning doesn't zero a live streak.
  const todayScore = finite(byDate.get(today)?.recovery_score);
  let cursor = todayScore == null ? addDays(today, -1) : today;
  let current: Streak = { length: 0, start: null, end: null };
  while (cursor >= windowStart) {
    const s = finite(byDate.get(cursor)?.recovery_score);
    if (s == null || recoveryBand(s) !== "high") break;
    current = { length: current.length + 1, start: cursor, end: current.end ?? cursor };
    cursor = addDays(cursor, -1);
  }

  const daysInWindow = diffDays(windowStart, today) + 1;
  const weekdayLabels = Array.from({ length: 7 }, (_, i) => WEEKDAYS[(weekStartDay + i) % 7]);

  return {
    today,
    windowStart,
    weekStartDay,
    weeks,
    monthLabels,
    weekdayLabels,
    daysInWindow,
    daysScored: scoredDays.length,
    coveragePct: Math.round((scoredDays.length / daysInWindow) * 100),
    bandCounts,
    currentGreenStreak: current,
    longestGreenStreak: longest,
    bestMonth,
    worstMonth,
    months,
    scoredDays,
  };
}

/** One-sentence summary used as the heatmap's accessible name. */
export function describeCalendar(cal: RecoveryCalendar): string {
  if (cal.daysScored === 0) {
    return `Recovery calendar, ${cal.windowStart} to ${cal.today}: no scored days.`;
  }
  const { high, mid, low } = cal.bandCounts;
  const parts = [
    `Recovery calendar, ${cal.windowStart} to ${cal.today}`,
    `${cal.daysScored} of ${cal.daysInWindow} days scored`,
    `${high} high, ${mid} mid, ${low} low`,
    `current green streak ${cal.currentGreenStreak.length} days, longest ${cal.longestGreenStreak.length}`,
  ];
  if (cal.bestMonth) parts.push(`best month ${cal.bestMonth.label} (average ${cal.bestMonth.average}%)`);
  if (cal.worstMonth) parts.push(`worst month ${cal.worstMonth.label} (average ${cal.worstMonth.average}%)`);
  return `${parts.join("; ")}.`;
}
