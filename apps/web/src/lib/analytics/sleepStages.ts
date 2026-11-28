/**
 * Sleep stages deep-dive (`/sleep/stages`, flag `SLEEP_STAGES=1`).
 *
 * Pure computation over the non-nap, one-row-per-wake-day sleep rows that
 * `getSleepRange` returns (naps are excluded in SQL; `SLEEP_DEDUP_WHERE`
 * picks one night per date). Per-night stage minutes come from
 * `stageMinutesFromRow` in `deepSleep.ts`.
 *
 * ## Definitions
 *
 * - **Stage night**: a night whose light, deep, REM and awake durations are
 *   all present and non-negative, with some asleep time. Anything else is
 *   counted as "no stage data" and excluded from every statistic.
 * - **% of night**: stage minutes / (light + deep + REM + awake), so the four
 *   shares add up to 100%.
 * - **Window stats** (14/30/90 days, `?days=`): mean and median minutes and
 *   % per stage across the window's stage nights.
 * - **Typical range** ("your normal"): the 25th–75th percentile (linear
 *   interpolation between order statistics, the same as numpy's default) of
 *   deep and REM minutes across every stage night in the last
 *   `HISTORY_DAYS`, *excluding* the latest night so it is judged against the
 *   nights before it. Needs `MIN_NIGHTS` history nights. The latest night is
 *   then "below" (< p25), "within" (p25..p75 inclusive) or "above" (> p75).
 * - **Trend**: mean deep / REM minutes over the last `TREND_DAYS` calendar
 *   days vs the `TREND_DAYS` before that (each side needs `MIN_NIGHTS` stage
 *   nights), plus the least-squares slope across the recent 30 days in
 *   minutes per week. A change under `STEADY_MIN` minutes reads "steady".
 *
 * Dates are `YYYY-MM-DD` wake days shifted with UTC arithmetic, and stage
 * durations are elapsed milliseconds, so DST changes neither the day grid
 * nor a night's minutes.
 */
import type { SleepRow } from "@/lib/db/sleep";
import { shiftDate } from "@/lib/range";
import { stageMinutesFromRow, type StageMinutes } from "./deepSleep";

export const STAGE_WINDOWS = [14, 30, 90] as const;
export type StageWindow = (typeof STAGE_WINDOWS)[number];
export const DEFAULT_STAGE_WINDOW: StageWindow = 30;
/** Calendar days read for the personal typical range. */
export const HISTORY_DAYS = 365;
/** Below this many stage nights the page (or a sub-stat) says "not enough data". */
export const MIN_NIGHTS = 7;
export const TREND_DAYS = 30;
/** Mean change (minutes) under which a trend reads "steady". */
export const STEADY_MIN = 5;

export const STAGE_KEYS = ["deep", "rem", "light", "awake"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export const STAGE_LABEL: Record<StageKey, string> = {
  deep: "Deep",
  rem: "REM",
  light: "Light",
  awake: "Awake",
};

export function parseStagesWindow(raw: string | undefined): StageWindow {
  if (raw === "14") return 14;
  if (raw === "90") return 90;
  return DEFAULT_STAGE_WINDOW;
}

export { shiftDate };

export type StageNight = StageMinutes & { date: string };

export type StageStat = {
  meanMin: number;
  medianMin: number;
  meanPct: number;
  medianPct: number;
};

export type Position = "below" | "within" | "above";

export type TypicalRange = {
  stage: "deep" | "rem";
  p25: number;
  p75: number;
  /** History nights the range was built from. */
  n: number;
  latest: number;
  position: Position;
};

export type StageTrend = {
  stage: "deep" | "rem";
  recentMean: number;
  priorMean: number | null;
  /** recentMean − priorMean, minutes. */
  delta: number | null;
  /** Least-squares slope across the recent window, minutes per week. */
  slopePerWeek: number | null;
  recentNights: number;
  priorNights: number;
  direction: "up" | "down" | "steady" | null;
};

export type SleepStagesResult = {
  windowDays: StageWindow;
  start: string;
  end: string;
  /** Recorded (non-nap) nights in the window, with or without stages. */
  recordedNights: number;
  /** Recorded nights in the window with no usable stage data. */
  noStageNights: number;
  /** Stage nights in the window, oldest first. */
  nights: StageNight[];
} & (
  | { status: "insufficient" }
  | {
      status: "ok";
      stats: Record<StageKey, StageStat>;
      latest: StageNight | null;
      ranges: { deep: TypicalRange | null; rem: TypicalRange | null };
      trends: { deep: StageTrend; rem: StageTrend };
      takeaway: string;
    }
);

export function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

/** Linear-interpolated quantile (numpy default / R type 7). `q` in [0, 1]. */
export function quantile(xs: readonly number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function median(xs: readonly number[]): number {
  return quantile(xs, 0.5);
}

/** Valid stage nights with dates in [start, end], oldest first, one per date. */
export function toStageNights(rows: readonly SleepRow[], start: string, end: string): {
  nights: StageNight[];
  recorded: number;
} {
  const byDate = new Map<string, StageNight | null>();
  for (const r of rows) {
    if (r.date < start || r.date > end || byDate.has(r.date)) continue;
    const m = stageMinutesFromRow(r);
    byDate.set(r.date, m ? { date: r.date, ...m } : null);
  }
  const nights = [...byDate.values()]
    .filter((n): n is StageNight => n != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { nights, recorded: byDate.size };
}

function pct(n: StageNight, k: StageKey): number {
  return n.total > 0 ? (n[k] / n.total) * 100 : 0;
}

export function stageStats(nights: readonly StageNight[]): Record<StageKey, StageStat> {
  const out = {} as Record<StageKey, StageStat>;
  for (const k of STAGE_KEYS) {
    const mins = nights.map((n) => n[k]);
    const pcts = nights.map((n) => pct(n, k));
    out[k] = { meanMin: mean(mins), medianMin: median(mins), meanPct: mean(pcts), medianPct: median(pcts) };
  }
  return out;
}

export function positionIn(value: number, p25: number, p75: number): Position {
  if (value < p25) return "below";
  if (value > p75) return "above";
  return "within";
}

export function typicalRange(
  history: readonly StageNight[],
  latest: StageNight | null,
  stage: "deep" | "rem",
): TypicalRange | null {
  if (!latest) return null;
  const prior = history.filter((n) => n.date !== latest.date).map((n) => n[stage]);
  if (prior.length < MIN_NIGHTS) return null;
  const p25 = quantile(prior, 0.25);
  const p75 = quantile(prior, 0.75);
  return { stage, p25, p75, n: prior.length, latest: latest[stage], position: positionIn(latest[stage], p25, p75) };
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** Least-squares slope of `y` against calendar day, per day; null under 2 distinct days. */
export function slopePerDay(points: readonly { date: string; y: number }[]): number | null {
  if (points.length < 2) return null;
  const xs = points.map((p) => dayNumber(p.date));
  const mx = mean(xs);
  const my = mean(points.map((p) => p.y));
  let sxx = 0;
  let sxy = 0;
  points.forEach((p, i) => {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (p.y - my);
  });
  return sxx === 0 ? null : sxy / sxx;
}

export function stageTrend(history: readonly StageNight[], today: string, stage: "deep" | "rem"): StageTrend {
  const recentStart = shiftDate(today, -(TREND_DAYS - 1));
  const priorStart = shiftDate(today, -(2 * TREND_DAYS - 1));
  const recent = history.filter((n) => n.date >= recentStart && n.date <= today);
  const prior = history.filter((n) => n.date >= priorStart && n.date < recentStart);
  const recentOk = recent.length >= MIN_NIGHTS;
  const priorOk = prior.length >= MIN_NIGHTS;
  const recentMean = mean(recent.map((n) => n[stage]));
  const priorMean = priorOk ? mean(prior.map((n) => n[stage])) : null;
  const delta = recentOk && priorMean != null ? recentMean - priorMean : null;
  const slope = recentOk ? slopePerDay(recent.map((n) => ({ date: n.date, y: n[stage] }))) : null;
  const direction =
    delta == null ? null : Math.abs(delta) < STEADY_MIN ? "steady" : delta > 0 ? "up" : "down";
  return {
    stage,
    recentMean,
    priorMean,
    delta,
    slopePerWeek: slope == null ? null : slope * 7,
    recentNights: recent.length,
    priorNights: prior.length,
    direction,
  };
}

export function formatMin(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

function rangeSentence(r: TypicalRange | null, label: string): string | null {
  if (!r) return null;
  const span = `${Math.round(r.p25)}–${Math.round(r.p75)} min`;
  const where =
    r.position === "within" ? "within" : r.position === "below" ? "below" : "above";
  return `${label} (${formatMin(r.latest)}) was ${where} your typical ${span}.`;
}

function trendSentence(t: StageTrend, label: string): string | null {
  if (t.delta == null || t.direction == null) return null;
  if (t.direction === "steady") return `${label} has held steady over the last 30 days.`;
  const more = t.direction === "up" ? "more" : "less";
  return `${label} averaged ${Math.round(Math.abs(t.delta))} min ${more} a night than the 30 days before.`;
}

/** Plain-language takeaway; deterministic, no model calls. */
export function buildTakeaway(
  latest: StageNight | null,
  ranges: { deep: TypicalRange | null; rem: TypicalRange | null },
  trends: { deep: StageTrend; rem: StageTrend },
): string {
  const parts: string[] = [];
  if (latest) {
    const deepS = rangeSentence(ranges.deep, "Your latest night's deep sleep");
    const remS = rangeSentence(ranges.rem, "REM");
    if (deepS) parts.push(deepS);
    if (remS) parts.push(remS);
  }
  const deepT = trendSentence(trends.deep, "Deep sleep");
  const remT = trendSentence(trends.rem, "REM");
  if (deepT) parts.push(deepT);
  if (remT) parts.push(remT);
  const bothLow = ranges.deep?.position === "below" && ranges.rem?.position === "below";
  if (bothLow) {
    parts.push("Both were short: a longer night in bed tends to add REM first, and a lighter training day can help deep sleep.");
  } else if (trends.deep.direction === "down" && trends.rem.direction === "down") {
    parts.push("Both are trending down; check whether total time in bed has shrunk.");
  }
  if (!parts.length) {
    return "Your stage mix looks like your usual. More history will unlock range and trend comparisons.";
  }
  return parts.join(" ");
}

export function computeSleepStages(
  rows: readonly SleepRow[],
  today: string,
  windowDays: StageWindow,
): SleepStagesResult {
  const start = shiftDate(today, -(windowDays - 1));
  const { nights, recorded } = toStageNights(rows, start, today);
  const base = {
    windowDays,
    start,
    end: today,
    recordedNights: recorded,
    noStageNights: recorded - nights.length,
    nights,
  };
  if (nights.length < MIN_NIGHTS) return { ...base, status: "insufficient" };

  const history = toStageNights(rows, shiftDate(today, -(HISTORY_DAYS - 1)), today).nights;
  const latest = history.length ? history[history.length - 1] : null;
  const ranges = { deep: typicalRange(history, latest, "deep"), rem: typicalRange(history, latest, "rem") };
  const trends = { deep: stageTrend(history, today, "deep"), rem: stageTrend(history, today, "rem") };
  return {
    ...base,
    status: "ok",
    stats: stageStats(nights),
    latest,
    ranges,
    trends,
    takeaway: buildTakeaway(latest, ranges, trends),
  };
}
