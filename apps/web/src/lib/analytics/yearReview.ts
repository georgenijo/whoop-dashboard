// Year in Review — pure aggregation over one calendar year of a single user's
// already-scoped rows (recovery, sleep, cycles, workouts).
//
// No DB, no network, no clock: the caller passes the rows plus `today` (the
// user's local YYYY-MM-DD). Every date is handled as a plain `YYYY-MM-DD`
// string and converted to a UTC day number for arithmetic, so DST transitions
// and the server's own timezone can never shift a day or break a streak.

import type { RecoveryRow } from "@/lib/db/recovery";
import type { SleepRow } from "@/lib/db/sleep";
import type { CycleRow } from "@/lib/db/strain";
import type { WorkoutRow } from "@/lib/db/workouts";

/** Oldest year `/year` accepts. Whoop scoring did not exist before this. */
export const MIN_REVIEW_YEAR = 2012;

/** Recovery score at/above which a day counts as "green" (matches `recoveryZone`). */
export const GREEN_RECOVERY = 67;

/** A month needs this many scored days to compete for best/worst month. */
export const MIN_MONTH_DAYS = 5;

/** A month needs this many nights with a consistency score to anchor the trend. */
export const MIN_CONSISTENCY_NIGHTS = 5;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export type YearReviewInput = {
  recovery: RecoveryRow[];
  sleep: SleepRow[];
  cycles: CycleRow[];
  workouts: WorkoutRow[];
};

export type DatedValue = { value: number; date: string };

export type MonthStat = {
  /** 1–12 */
  month: number;
  label: string;
  /** Days in this month with a recovery score. */
  scoredDays: number;
  recovery: number | null;
  hrv: number | null;
  rhr: number | null;
  /** Average hours asleep (light + deep + REM) per night. */
  sleepHours: number | null;
  /** Average Whoop sleep consistency (%). */
  consistency: number | null;
  consistencyNights: number;
  /** True for the in-progress month of the current year. */
  partial: boolean;
};

export type SportStat = { sport: string; count: number; minutes: number };

export type YearReview = {
  year: number;
  start: string;
  /** Last day covered: Dec 31, or `today` for the current year. */
  end: string;
  isCurrentYear: boolean;
  /** 365 or 366. */
  daysInYear: number;
  /** Calendar days from Jan 1 through `end`, inclusive. */
  daysElapsed: number;
  hasData: boolean;
  daysScored: number;
  averages: {
    recovery: number | null;
    hrv: number | null;
    rhr: number | null;
    sleepHours: number | null;
    strain: number | null;
  };
  /** Jan..end-month (12 entries for a past year). */
  months: MonthStat[];
  bestMonth: MonthStat | null;
  worstMonth: MonthStat | null;
  greenStreak: { days: number; start: string; end: string } | null;
  greenDays: number;
  highestStrainDay: DatedValue | null;
  workouts: {
    count: number;
    minutes: number;
    /** Minutes in HR zones 1–5 (index 0 = zone 1). */
    zoneMinutes: number[];
    topSports: SportStat[];
  };
  consistencyTrend: {
    from: { label: string; value: number };
    to: { label: string; value: number };
    delta: number;
  } | null;
  personalBests: {
    highestHrv: DatedValue | null;
    lowestRhr: DatedValue | null;
    longestSleepHours: DatedValue | null;
  };
  highlights: string[];
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** UTC day number for a valid `YYYY-MM-DD`, else null. Rejects 2025-02-30. */
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
  return Math.round(ms / DAY_MS);
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Validate `?y=`. Anything that is not a plain 4-digit year between
 * MIN_REVIEW_YEAR and the current year falls back to the current year — a
 * future year has nothing to review and an absurd one would be a wasted read.
 */
export function parseReviewYear(raw: string | string[] | undefined, currentYear: number): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string" || !/^\d{4}$/.test(v)) return currentYear;
  const y = Number(v);
  if (y < MIN_REVIEW_YEAR || y > currentYear) return currentYear;
  return y;
}

/** Inclusive `[start, end]` read window for `year`, clamped to `today`. */
export function yearBounds(year: number, today: string): { start: string; end: string } {
  const start = `${year}-01-01`;
  const dec31 = `${year}-12-31`;
  const end = today >= start && today < dec31 ? today : dec31;
  return { start, end };
}

/** "Mar 4" from `YYYY-MM-DD` without constructing a local Date. */
export function shortDate(date: string): string {
  const m = DATE_RE.exec(date);
  if (!m) return date;
  return `${MONTH_SHORT[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function monthOf(date: string): number {
  return Number(date.slice(5, 7));
}

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function mean(values: (number | null)[]): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v != null) {
      sum += v;
      n++;
    }
  }
  return n === 0 ? null : sum / n;
}

/** Hours actually asleep. Falls back to in-bed minus awake when stages are missing. */
export function asleepHours(row: SleepRow): number | null {
  const light = num(row.light_ms);
  const deep = num(row.deep_ms);
  const rem = num(row.rem_ms);
  let ms: number | null = null;
  if (light != null || deep != null || rem != null) {
    ms = (light ?? 0) + (deep ?? 0) + (rem ?? 0);
  } else {
    const bed = num(row.in_bed_ms);
    if (bed != null) ms = bed - (num(row.awake_ms) ?? 0);
  }
  if (ms == null || ms <= 0) return null;
  return ms / 3_600_000;
}

/** Pick the extreme value; ties go to the earliest date so the result is stable. */
function extreme<T extends { date: string }>(
  rows: T[],
  pick: (r: T) => number | null,
  better: (a: number, b: number) => boolean,
): DatedValue | null {
  let best: DatedValue | null = null;
  for (const r of rows) {
    const v = pick(r);
    if (v == null) continue;
    if (best == null || better(v, best.value) || (v === best.value && r.date < best.date)) {
      best = { value: v, date: r.date };
    }
  }
  return best;
}

/** Keep rows inside the window with a valid date; one row per date (first wins). */
function clampRows<T extends { date: string }>(rows: T[], start: string, end: string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (typeof r.date !== "string" || dayNumber(r.date) == null) continue;
    if (r.date < start || r.date > end || seen.has(r.date)) continue;
    seen.add(r.date);
    out.push(r);
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * Longest run of consecutive calendar days scored green. A day with no score
 * (strap off, gap in sync) breaks the run — the streak is a claim about every
 * day in it.
 */
export function longestGreenStreak(
  recovery: { date: string; recovery_score: number | null }[],
): { days: number; start: string; end: string } | null {
  const byDay = new Map<number, string>();
  for (const r of recovery) {
    if ((num(r.recovery_score) ?? -1) < GREEN_RECOVERY) continue;
    const n = dayNumber(r.date);
    if (n != null) byDay.set(n, r.date);
  }
  const greens = [...byDay.entries()]
    .map(([n, date]) => ({ n, date }))
    .sort((a, b) => a.n - b.n);

  let best: { days: number; start: string; end: string } | null = null;
  let runStart = 0;
  for (let i = 0; i < greens.length; i++) {
    if (i > 0 && greens[i].n !== greens[i - 1].n + 1) runStart = i;
    const days = greens[i].n - greens[runStart].n + 1;
    if (best == null || days > best.days) {
      best = { days, start: greens[runStart].date, end: greens[i].date };
    }
  }
  return best;
}

function buildMonths(
  year: number,
  end: string,
  isCurrentYear: boolean,
  recovery: RecoveryRow[],
  sleep: SleepRow[],
): MonthStat[] {
  const lastMonth = monthOf(end);
  const months: MonthStat[] = [];
  for (let m = 1; m <= lastMonth; m++) {
    const rec = recovery.filter((r) => monthOf(r.date) === m);
    const slp = sleep.filter((s) => monthOf(s.date) === m);
    const consistency = slp.map((s) => num(s.consistency));
    months.push({
      month: m,
      label: MONTH_NAMES[m - 1],
      scoredDays: rec.filter((r) => num(r.recovery_score) != null).length,
      recovery: mean(rec.map((r) => num(r.recovery_score))),
      hrv: mean(rec.map((r) => num(r.hrv))),
      rhr: mean(rec.map((r) => num(r.rhr))),
      sleepHours: mean(slp.map(asleepHours)),
      consistency: mean(consistency),
      consistencyNights: consistency.filter((v) => v != null).length,
      partial: isCurrentYear && m === lastMonth && end < `${year}-12-31`,
    });
  }
  return months;
}

function buildSports(workouts: WorkoutRow[]): SportStat[] {
  const by = new Map<string, SportStat>();
  for (const w of workouts) {
    const sport = (w.sport ?? "").trim() || "Other";
    const s = by.get(sport) ?? { sport, count: 0, minutes: 0 };
    s.count++;
    s.minutes += Math.max(0, num(w.duration_sec) ?? 0) / 60;
    by.set(sport, s);
  }
  return [...by.values()].sort(
    (a, b) => b.count - a.count || b.minutes - a.minutes || a.sport.localeCompare(b.sport),
  );
}

function round(v: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

function buildHighlights(r: Omit<YearReview, "highlights">): string[] {
  if (!r.hasData) return [];
  const out: string[] = [];

  if (r.daysScored > 0) {
    const pct = Math.round((r.daysScored / r.daysElapsed) * 100);
    const pctStr = pct === 0 ? "under 1%" : `${pct}%`;
    const scope = r.isCurrentYear ? "of the year so far" : `of ${r.year}`;
    out.push(`You were scored on ${plural(r.daysScored, "day")} — ${pctStr} ${scope}.`);
  }
  if (r.bestMonth && r.bestMonth.recovery != null) {
    out.push(
      `${r.bestMonth.label} was your strongest month, averaging ${Math.round(r.bestMonth.recovery)}% recovery.`,
    );
  }
  if (r.greenStreak && r.greenStreak.days >= 2) {
    out.push(
      `Your longest green run was ${r.greenStreak.days} days in a row (${shortDate(r.greenStreak.start)} – ${shortDate(r.greenStreak.end)}).`,
    );
  }
  if (r.workouts.count > 0) {
    const hours = Math.round(r.workouts.minutes / 60);
    const top = r.workouts.topSports[0];
    const lead = top ? `; ${top.sport} led with ${plural(top.count, "session")}` : "";
    out.push(`You logged ${plural(r.workouts.count, "workout")} over ${plural(hours, "hour")}${lead}.`);
  }
  if (r.consistencyTrend && Math.abs(r.consistencyTrend.delta) >= 1) {
    const t = r.consistencyTrend;
    const verb = t.delta > 0 ? "rose" : "fell";
    out.push(
      `Sleep consistency ${verb} from ${Math.round(t.from.value)}% in ${t.from.label} to ${Math.round(t.to.value)}% in ${t.to.label}.`,
    );
  }
  if (r.personalBests.highestHrv) {
    out.push(
      `Your peak HRV was ${Math.round(r.personalBests.highestHrv.value)} ms on ${shortDate(r.personalBests.highestHrv.date)}.`,
    );
  }
  if (r.highestStrainDay) {
    out.push(
      `Your hardest day was ${shortDate(r.highestStrainDay.date)} at ${r.highestStrainDay.value.toFixed(1)} strain.`,
    );
  }
  return out.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function buildYearReview(year: number, today: string, input: YearReviewInput): YearReview {
  const { start, end } = yearBounds(year, today);
  const isCurrentYear = today.slice(0, 4) === String(year);
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const daysElapsed = Math.max(1, (dayNumber(end) ?? 0) - (dayNumber(start) ?? 0) + 1);

  const recovery = clampRows(input.recovery, start, end);
  const sleep = clampRows(input.sleep, start, end);
  const cycles = clampRows(input.cycles, start, end);
  // Workouts are many-per-day, so only clamp by window — never dedupe by date.
  const workouts = input.workouts.filter(
    (w) => typeof w.date === "string" && dayNumber(w.date) != null && w.date >= start && w.date <= end,
  );

  const months = buildMonths(year, end, isCurrentYear, recovery, sleep);
  const ranked = months
    .filter((m) => m.recovery != null && m.scoredDays >= MIN_MONTH_DAYS)
    .sort((a, b) => (b.recovery as number) - (a.recovery as number) || a.month - b.month);
  const bestMonth = ranked[0] ?? null;
  const worstMonth = ranked.length >= 2 ? ranked[ranked.length - 1] : null;

  const zoneMinutes = [0, 0, 0, 0, 0];
  let workoutMinutes = 0;
  for (const w of workouts) {
    workoutMinutes += Math.max(0, num(w.duration_sec) ?? 0) / 60;
    const zones = [w.zone_1_ms, w.zone_2_ms, w.zone_3_ms, w.zone_4_ms, w.zone_5_ms];
    zones.forEach((z, i) => {
      zoneMinutes[i] += Math.max(0, num(z) ?? 0) / 60_000;
    });
  }

  const anchors = months.filter(
    (m) => m.consistency != null && m.consistencyNights >= MIN_CONSISTENCY_NIGHTS,
  );
  const consistencyTrend =
    anchors.length >= 2
      ? {
          from: { label: anchors[0].label, value: anchors[0].consistency as number },
          to: {
            label: anchors[anchors.length - 1].label,
            value: anchors[anchors.length - 1].consistency as number,
          },
          delta:
            (anchors[anchors.length - 1].consistency as number) - (anchors[0].consistency as number),
        }
      : null;

  const base: Omit<YearReview, "highlights"> = {
    year,
    start,
    end,
    isCurrentYear,
    daysInYear,
    daysElapsed,
    hasData: recovery.length + sleep.length + cycles.length + workouts.length > 0,
    daysScored: recovery.filter((r) => num(r.recovery_score) != null).length,
    averages: {
      recovery: mean(recovery.map((r) => num(r.recovery_score))),
      hrv: mean(recovery.map((r) => num(r.hrv))),
      rhr: mean(recovery.map((r) => num(r.rhr))),
      sleepHours: mean(sleep.map(asleepHours)),
      strain: mean(cycles.map((c) => num(c.strain))),
    },
    months,
    bestMonth,
    worstMonth,
    greenStreak: longestGreenStreak(recovery),
    greenDays: recovery.filter((r) => (num(r.recovery_score) ?? -1) >= GREEN_RECOVERY).length,
    highestStrainDay: extreme(cycles, (c) => num(c.strain), (a, b) => a > b),
    workouts: {
      count: workouts.length,
      minutes: workoutMinutes,
      zoneMinutes: zoneMinutes.map((z) => round(z)),
      topSports: buildSports(workouts).slice(0, 5),
    },
    consistencyTrend,
    personalBests: {
      highestHrv: extreme(recovery, (r) => num(r.hrv), (a, b) => a > b),
      lowestRhr: extreme(recovery, (r) => num(r.rhr), (a, b) => a < b),
      longestSleepHours: extreme(sleep, asleepHours, (a, b) => a > b),
    },
  };
  return { ...base, highlights: buildHighlights(base) };
}
