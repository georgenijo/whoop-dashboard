/**
 * Sleep regularity (`/sleep/regularity`, flag `SLEEP_REGULARITY=1`).
 *
 * Pure computation over the non-nap, one-row-per-wake-day sleep rows that
 * `getSleepRange` already returns (naps are excluded in SQL and the
 * `SLEEP_DEDUP_WHERE` tie-break picks one night per date). Local-time parsing
 * and the 20:00 bedtime anchor are reused from `bedtime.ts`.
 *
 * ## Sleep Regularity Index (SRI)
 *
 * Phillips et al. 2017 (Sci Rep 7:3216):
 *
 *     SRI = -100 + 200 / (M·(N-1)) · Σ_days Σ_epochs δ(s[d][t], s[d+1][t])
 *
 * i.e. SRI = 200·P(match) − 100, where P(match) is the probability that the
 * sleep/wake state at a given clock time is the same 24 hours later. 100 is a
 * perfectly repeating schedule; 0 is no better than chance.
 *
 * How it is computed here:
 * - The timeline is local **wall-clock** time in 5-minute epochs. "24 hours
 *   later" means "the same clock time the next day", which is what the index
 *   is about. On a DST night the wall-clock in-bed span is an hour longer or
 *   shorter than elapsed time; the epoch grid stays aligned to the clock.
 * - Each wake day `d` owns the 24h block from 18:00 the evening before to
 *   18:00 on `d`. A night that crosses midnight lands in its wake day's block.
 * - "Asleep" = inside the night's in-bed window (`start_local`..`end_local`).
 *   Whoop doesn't expose per-epoch stages here, so brief wakes inside the
 *   window count as sleep — the index measures schedule regularity.
 * - Only consecutive days that BOTH have a recorded night are compared. A
 *   missing night is missing data (strap off), not a night awake, so it is
 *   skipped instead of being scored as a mismatch.
 * - Naps are excluded upstream, so they never count as sleep.
 */
import type { SleepRow } from "@/lib/db/sleep";
import {
  BEDTIME_ANCHOR_HOUR,
  WAKE_ANCHOR_HOUR,
  bedtimeHourFromAnchor,
  parseLocalParts,
  stddev,
  wakeHourFromAnchor,
} from "./bedtime";

export const REGULARITY_WINDOWS = [14, 30] as const;
export type RegularityWindow = (typeof REGULARITY_WINDOWS)[number];
export const DEFAULT_REGULARITY_WINDOW: RegularityWindow = 30;
/** Below this many nights in the window the page says "not enough data". */
export const MIN_NIGHTS = 7;
/** Consecutive-night pairs needed before an SRI is shown. */
export const MIN_SRI_PAIRS = 5;
export const EPOCH_MIN = 5;
const EPOCHS_PER_DAY = (24 * 60) / EPOCH_MIN;
/** Wake-day block starts at 18:00 the previous evening. */
const BLOCK_START_HOUR = 18;
/** Same sanity bound as `computeBedtimePatterns`. */
const MAX_NIGHT_HOURS = 16;

export function parseRegularityWindow(raw: string | undefined): RegularityWindow {
  return raw === "14" ? 14 : DEFAULT_REGULARITY_WINDOW;
}

export type RegularityNight = {
  /** Wake day (matches `sleep.date`). */
  date: string;
  /** Calendar day the night started — the day before `date` past midnight. */
  bedDate: string;
  /** Bedtime, hours after 20:00 (0..24). */
  bedFromAnchor: number;
  /** Wake time, hours after 00:00 (0..24). */
  wakeFromAnchor: number;
  /** Wall-clock in-bed hours. */
  hours: number;
  /** Mid-sleep, hours after 20:00 of the bed evening. */
  midFromAnchor: number;
  /** Wake day is Saturday or Sunday (the nights before free days). */
  weekend: boolean;
  /** Wall-clock minutes since epoch for the in-bed window. */
  startWallMin: number;
  endWallMin: number;
};

export type TimingStats = {
  /** Clock hour 0..24. */
  median: number;
  sdMin: number;
  earliest: { hour: number; date: string };
  latest: { hour: number; date: string };
};

export type SocialJetlag = {
  /** Weekend minus weekday mean mid-sleep, minutes (positive = weekend later). */
  minutes: number;
  weekdayMid: number;
  weekendMid: number;
  weekdayNights: number;
  weekendNights: number;
};

export type RegularityTone = "good" | "ok" | "warn" | "bad";

export type SleepRegularityResult =
  | {
      status: "insufficient";
      windowDays: RegularityWindow;
      start: string;
      end: string;
      nights: RegularityNight[];
    }
  | {
      status: "ok";
      windowDays: RegularityWindow;
      start: string;
      end: string;
      nights: RegularityNight[];
      /** -100..100, null when fewer than MIN_SRI_PAIRS consecutive pairs. */
      sri: number | null;
      /** P(match) as 0..100. */
      matchPct: number | null;
      sriPairs: number;
      bedtime: TimingStats;
      wake: TimingStats;
      socialJetlag: SocialJetlag | null;
      rating: { label: string; tone: RegularityTone; basis: "sri" | "timing" };
      tip: string;
    };

// ---------------------------------------------------------------------------
// Date helpers (UTC-only arithmetic on YYYY-MM-DD strings; no host-TZ reads)
// ---------------------------------------------------------------------------

function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function shiftDate(date: string, days: number): string {
  return new Date(dayMs(date) + days * 86_400_000).toISOString().slice(0, 10);
}

function wallMinutes(date: string, hours: number): number {
  return dayMs(date) / 60_000 + hours * 60;
}

function isWeekendWakeDay(date: string): boolean {
  const dow = new Date(dayMs(date)).getUTCDay();
  return dow === 0 || dow === 6;
}

// ---------------------------------------------------------------------------
// Nights
// ---------------------------------------------------------------------------

/** Valid nights whose wake day falls inside [start, end], oldest first. */
export function toNights(rows: readonly SleepRow[], start: string, end: string): RegularityNight[] {
  const byDate = new Map<string, RegularityNight>();
  for (const r of rows) {
    if (r.date < start || r.date > end) continue;
    const s = parseLocalParts(r.start_local);
    const e = parseLocalParts(r.end_local);
    const bed = bedtimeHourFromAnchor(r.start_local);
    const wake = wakeHourFromAnchor(r.end_local);
    if (!s || !e || bed == null || wake == null) continue;
    const startWallMin = wallMinutes(s.date, s.hours);
    const endWallMin = wallMinutes(e.date, e.hours);
    const hours = (endWallMin - startWallMin) / 60;
    if (!(hours > 0) || hours > MAX_NIGHT_HOURS) continue;
    const night: RegularityNight = {
      date: r.date,
      bedDate: s.date,
      bedFromAnchor: bed,
      wakeFromAnchor: wake,
      hours,
      midFromAnchor: bed + hours / 2,
      weekend: isWeekendWakeDay(r.date),
      startWallMin,
      endWallMin,
    };
    // Readers already dedupe; keep the longest night if a caller didn't.
    const prev = byDate.get(r.date);
    if (!prev || night.hours > prev.hours) byDate.set(r.date, night);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ---------------------------------------------------------------------------
// SRI
// ---------------------------------------------------------------------------

export function computeSri(
  nights: readonly RegularityNight[],
  start: string,
  end: string,
): { sri: number | null; matchPct: number | null; pairs: number } {
  const nDays = Math.round((dayMs(end) - dayMs(start)) / 86_400_000) + 1;
  if (nDays < 2) return { sri: null, matchPct: null, pairs: 0 };
  const originMin = wallMinutes(shiftDate(start, -1), BLOCK_START_HOUR);
  const totalEpochs = nDays * EPOCHS_PER_DAY;
  const asleep = new Uint8Array(totalEpochs);
  const observed = new Uint8Array(nDays);

  for (const n of nights) {
    const k = Math.round((dayMs(n.date) - dayMs(start)) / 86_400_000);
    if (k >= 0 && k < nDays) observed[k] = 1;
    // Epoch e is asleep when its midpoint lies inside [start, end).
    const first = Math.max(0, Math.ceil((n.startWallMin - originMin) / EPOCH_MIN - 0.5));
    const last = Math.min(totalEpochs - 1, Math.ceil((n.endWallMin - originMin) / EPOCH_MIN - 0.5) - 1);
    for (let e = first; e <= last; e++) asleep[e] = 1;
  }

  let matches = 0;
  let compared = 0;
  let pairs = 0;
  for (let k = 0; k < nDays - 1; k++) {
    if (!observed[k] || !observed[k + 1]) continue;
    pairs++;
    const base = k * EPOCHS_PER_DAY;
    for (let i = 0; i < EPOCHS_PER_DAY; i++) {
      if (asleep[base + i] === asleep[base + i + EPOCHS_PER_DAY]) matches++;
      compared++;
    }
  }
  if (pairs < MIN_SRI_PAIRS || compared === 0) return { sri: null, matchPct: null, pairs };
  const p = matches / compared;
  return { sri: 200 * p - 100, matchPct: p * 100, pairs };
}

// ---------------------------------------------------------------------------
// Timing stats
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function toClock(fromAnchor: number, anchor: number): number {
  return (((anchor + fromAnchor) % 24) + 24) % 24;
}

function timingStats(
  nights: readonly RegularityNight[],
  pick: (n: RegularityNight) => number,
  anchor: number,
): TimingStats {
  const vals = nights.map(pick);
  let lo = 0;
  let hi = 0;
  vals.forEach((v, i) => {
    if (v < vals[lo]) lo = i;
    if (v > vals[hi]) hi = i;
  });
  return {
    median: toClock(median(vals), anchor),
    sdMin: stddev(vals) * 60,
    earliest: { hour: toClock(vals[lo], anchor), date: nights[lo].date },
    latest: { hour: toClock(vals[hi], anchor), date: nights[hi].date },
  };
}

export function computeSocialJetlag(nights: readonly RegularityNight[]): SocialJetlag | null {
  const wd = nights.filter((n) => !n.weekend);
  const we = nights.filter((n) => n.weekend);
  if (wd.length === 0 || we.length === 0) return null;
  const mean = (a: RegularityNight[]) => a.reduce((s, n) => s + n.midFromAnchor, 0) / a.length;
  const weekdayMid = mean(wd);
  const weekendMid = mean(we);
  return {
    minutes: (weekendMid - weekdayMid) * 60,
    weekdayMid: toClock(weekdayMid, BEDTIME_ANCHOR_HOUR),
    weekendMid: toClock(weekendMid, BEDTIME_ANCHOR_HOUR),
    weekdayNights: wd.length,
    weekendNights: we.length,
  };
}

// ---------------------------------------------------------------------------
// Rating + tip
// ---------------------------------------------------------------------------

export function formatClock(hour: number): string {
  const totalMin = Math.round((((hour % 24) + 24) % 24) * 60) % (24 * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  const period = hh >= 12 ? "pm" : "am";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${mm.toString().padStart(2, "0")}${period}`;
}

export function formatMinutes(min: number): string {
  const m = Math.round(Math.abs(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

export function rateRegularity(
  sri: number | null,
  bedSdMin: number,
  wakeSdMin: number,
): { label: string; tone: RegularityTone; basis: "sri" | "timing" } {
  if (sri != null) {
    if (sri >= 80) return { label: "Very regular", tone: "good", basis: "sri" };
    if (sri >= 70) return { label: "Regular", tone: "ok", basis: "sri" };
    if (sri >= 60) return { label: "Somewhat irregular", tone: "warn", basis: "sri" };
    return { label: "Irregular", tone: "bad", basis: "sri" };
  }
  const worst = Math.max(bedSdMin, wakeSdMin);
  if (worst <= 30) return { label: "Very regular", tone: "good", basis: "timing" };
  if (worst <= 45) return { label: "Regular", tone: "ok", basis: "timing" };
  if (worst <= 75) return { label: "Somewhat irregular", tone: "warn", basis: "timing" };
  return { label: "Irregular", tone: "bad", basis: "timing" };
}

/** One concrete, schedule-based tip aimed at the biggest source of irregularity. */
export function pickTip(bed: TimingStats, wake: TimingStats, jetlag: SocialJetlag | null): string {
  if (jetlag && Math.abs(jetlag.minutes) >= 60) {
    const dir = jetlag.minutes > 0 ? "later" : "earlier";
    return (
      `Your weekend mid-sleep runs ${formatMinutes(jetlag.minutes)} ${dir} than on weekdays. ` +
      `Keep weekend wake-ups within an hour of your usual ${formatClock(wake.median)} — ` +
      `catching up with an early nap beats a long lie-in.`
    );
  }
  if (wake.sdMin >= 45 && wake.sdMin >= bed.sdMin) {
    return (
      `Your wake time varies by about ${formatMinutes(wake.sdMin)}. ` +
      `Anchor it: get up at ${formatClock(wake.median)} every day, including weekends, ` +
      `and get daylight in the first 30 minutes.`
    );
  }
  if (bed.sdMin >= 45) {
    return (
      `Your bedtime varies by about ${formatMinutes(bed.sdMin)}. ` +
      `Start winding down at ${formatClock(bed.median - 0.5)} so you're in bed near your ` +
      `usual ${formatClock(bed.median)}.`
    );
  }
  return (
    `Your schedule is steady. Keep bedtime near ${formatClock(bed.median)} and wake near ` +
    `${formatClock(wake.median)} — consistency protects recovery more than any single long night.`
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * @param rows  non-nap, deduped sleep rows (e.g. `getSleepRange`) covering
 *              at least [today - windowDays + 1, today]
 * @param today the user's local calendar date (YYYY-MM-DD)
 */
export function computeSleepRegularity(
  rows: readonly SleepRow[],
  today: string,
  windowDays: RegularityWindow = DEFAULT_REGULARITY_WINDOW,
): SleepRegularityResult {
  const start = shiftDate(today, -(windowDays - 1));
  const nights = toNights(rows, start, today);
  if (nights.length < MIN_NIGHTS) {
    return { status: "insufficient", windowDays, start, end: today, nights };
  }
  const { sri, matchPct, pairs } = computeSri(nights, start, today);
  const bedtime = timingStats(nights, (n) => n.bedFromAnchor, BEDTIME_ANCHOR_HOUR);
  const wake = timingStats(nights, (n) => n.wakeFromAnchor, WAKE_ANCHOR_HOUR);
  const socialJetlag = computeSocialJetlag(nights);
  return {
    status: "ok",
    windowDays,
    start,
    end: today,
    nights,
    sri,
    matchPct,
    sriPairs: pairs,
    bedtime,
    wake,
    socialJetlag,
    rating: rateRegularity(sri, bedtime.sdMin, wake.sdMin),
    tip: pickTip(bedtime, wake, socialJetlag),
  };
}
