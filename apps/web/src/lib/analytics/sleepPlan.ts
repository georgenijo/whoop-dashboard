/**
 * "Tonight's sleep plan" — a pure, deterministic bedtime recommendation built
 * from data the /sleep page already reads (issue: none; see PR description).
 *
 * Inputs are the user's own non-nap `SleepRow`s and `RecoveryRow`s (already
 * tenant-scoped by `@/lib/db` readers). No I/O happens here: the only
 * environmental dependency — the local UTC offset used for DST maths — is
 * injectable so tests can pin it.
 *
 * Method, in order:
 *  1. Typical wake time = circular median of the last 14 valid wake times.
 *  2. Sleep target = baseline need (median of recent `need_from_baseline_ms`,
 *     falling back to `sleep_need_ms`, then 8 h) + a capped payback of the
 *     last-7-night sleep debt (same `max(0, need − actual)` rule
 *     SleepDebtChart plots).
 *  3. Time in bed = target ÷ typical sleep efficiency.
 *  4. Bedtime = wake − time in bed, corrected for a DST change between bed
 *     and wake (wall clocks lie about elapsed time on those nights).
 *  5. If earlier bedtimes track with better recovery (the same correlation
 *     `computeBedtimeRecoveryCorr` reports) and the user's best-recovery
 *     nights began earlier than step 4's answer, pull the bedtime earlier —
 *     by at most 60 min, so the plan never becomes unrealistic.
 */
import type { RecoveryRow } from "@/lib/db/recovery";
import type { SleepRow } from "@/lib/db/sleep";
import { computeBedtimeRecoveryCorr } from "@/lib/analytics/bedtime";

const MIN_PER_DAY = 1440;
const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 3_600_000;

export const SLEEP_PLAN_MIN_NIGHTS = 5;
export const WAKE_WINDOW_NIGHTS = 14;
export const DEBT_WINDOW_NIGHTS = 7;
export const WIND_DOWN_MIN = 45;
/** Lookback the page should read for the plan (calendar days, inclusive). */
export const SLEEP_PLAN_LOOKBACK_DAYS = 30;
/** Wake-time spread (median absolute deviation) above which we call the
 *  schedule irregular. 45 min MAD ≈ 1 h standard deviation. */
export const IRREGULAR_MAD_MIN = 45;
const DEFAULT_NEED_MS = 8 * MS_PER_HOUR;
const DEFAULT_EFFICIENCY = 0.9;
const MAX_PAYBACK_MS = 60 * MS_PER_MIN;
const PAYBACK_FRACTION = 0.5;
const MAX_RECOVERY_PULL_MIN = 60;
const RECOVERY_CORR_THRESHOLD = -0.2;

/** Server-side flag. Read per call (not at module load) so tests and a
 *  restarted service pick up changes. */
export function isSleepPlanEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SLEEP_PLAN === "1";
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

type LocalParts = { date: string; minutes: number };

function parseLocal(s: string | null): LocalParts | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const h = Number(m[4]);
  const min = Number(m[5]);
  const sec = m[6] ? Number(m[6]) : 0;
  if (h > 23 || min > 59 || sec > 59) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, minutes: h * 60 + min + sec / 60 };
}

function dayIndex(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / (MIN_PER_DAY * MS_PER_MIN));
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Wrap any minute value into [0, 1440). */
export function wrapMinutes(m: number): number {
  return ((m % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
}

/** Signed shortest distance a − b on the 24 h clock, in (−720, 720]. */
export function circularDiff(a: number, b: number): number {
  let d = wrapMinutes(a - b);
  if (d > MIN_PER_DAY / 2) d -= MIN_PER_DAY;
  return d;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Median of clock times that may straddle midnight (23:50 and 00:10 → 00:00,
 * not 12:00). Unwraps every value around the circular mean, takes an ordinary
 * median, and rewraps.
 */
export function circularMedianMinutes(values: number[]): number | null {
  if (values.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const v of values) {
    const rad = (v / MIN_PER_DAY) * 2 * Math.PI;
    sx += Math.cos(rad);
    sy += Math.sin(rad);
  }
  const center =
    Math.hypot(sx, sy) < 1e-9
      ? values[0]
      : wrapMinutes((Math.atan2(sy, sx) / (2 * Math.PI)) * MIN_PER_DAY);
  const unwrapped = values.map((v) => center + circularDiff(v, center));
  return wrapMinutes(median(unwrapped)!);
}

function circularMad(values: number[], center: number): number {
  return median(values.map((v) => Math.abs(circularDiff(v, center)))) ?? 0;
}

/** "22:45" (24 h clock) for a minute-of-day. */
export function formatClock(minutes: number): string {
  const m = Math.round(wrapMinutes(minutes)) % MIN_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Local UTC offset (minutes east of UTC) in effect at a given local wall-clock
 * moment. Default uses the server's zone — the same assumption `localToday()`
 * already makes about the app being served in its user's zone.
 */
export type OffsetAt = (date: string, minutesOfDay: number) => number;

export const serverOffsetAt: OffsetAt = (date, minutesOfDay) => {
  const [y, mo, d] = date.split("-").map(Number);
  const local = new Date(y, mo - 1, d, 0, Math.round(minutesOfDay));
  return -local.getTimezoneOffset();
};

// ---------------------------------------------------------------------------
// Nights
// ---------------------------------------------------------------------------

export type Night = {
  /** Wake day (matches `sleep.date`, issue #440). */
  date: string;
  /** Calendar day the bedtime fell on (day before `date` if before midnight). */
  bedDate: string;
  bedMin: number;
  wakeMin: number;
  row: SleepRow;
};

/** Valid main sleeps, oldest → newest, at most one per wake day. */
export function toNights(sleep: SleepRow[]): Night[] {
  const byDate = new Map<string, Night>();
  for (const row of sleep) {
    const bed = parseLocal(row.start_local);
    const wake = parseLocal(row.end_local);
    if (!bed || !wake) continue;
    const spanMin =
      (dayIndex(wake.date) - dayIndex(bed.date)) * MIN_PER_DAY + wake.minutes - bed.minutes;
    if (spanMin <= 0 || spanMin > 16 * 60) continue;
    byDate.set(row.date, {
      date: row.date,
      bedDate: bed.date,
      bedMin: bed.minutes,
      wakeMin: wake.minutes,
      row,
    });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function actualSleepMs(r: SleepRow): number | null {
  if (r.light_ms == null && r.deep_ms == null && r.rem_ms == null) return null;
  return (r.light_ms ?? 0) + (r.deep_ms ?? 0) + (r.rem_ms ?? 0);
}

/** Same rule SleepDebtChart plots: max(0, need − actual), 0 without a need. */
export function nightlyDebtMs(r: SleepRow): number {
  const need = r.sleep_need_ms ?? 0;
  const actual = actualSleepMs(r);
  if (need <= 0 || actual == null) return 0;
  return Math.max(0, need - actual);
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type SleepPlanStrip = {
  date: string;
  bedDate: string;
  bedMin: number;
  /** Minutes this bedtime was later (+) or earlier (−) than the plan. */
  deltaMin: number;
};

export type SleepPlanReady = {
  status: "ready";
  nights: number;
  /** Wake day the plan is for (the morning after `tonight`). */
  wakeDate: string;
  wakeMin: number;
  bedtimeMin: number;
  /** True when the recommended bedtime falls after midnight. */
  bedtimeAfterMidnight: boolean;
  windDownMin: number;
  /** Elapsed time between bedtime and wake (DST-corrected). */
  timeInBedMs: number;
  /** Expected sleep that bedtime yields (time in bed × efficiency). */
  yieldSleepMs: number;
  targetSleepMs: number;
  baselineNeedMs: number;
  needSource: "baseline" | "sleep_need" | "default";
  debtMs: number;
  paybackMs: number;
  efficiency: number;
  irregular: boolean;
  wakeSpreadMin: number;
  /** Bedtime of the user's better-recovery nights, when earlier is better. */
  recoveryBedtimeMin: number | null;
  /** DST shift between bed and wake, minutes (+60 spring forward). */
  dstShiftMin: number;
  reason: string;
  strip: SleepPlanStrip[];
};

export type SleepPlanInsufficient = {
  status: "insufficient";
  nights: number;
  needed: number;
};

export type SleepPlan = SleepPlanReady | SleepPlanInsufficient;

function recentMedian(rows: SleepRow[], pick: (r: SleepRow) => number | null): number | null {
  const vals = rows.map(pick).filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  return median(vals);
}

function typicalEfficiency(rows: SleepRow[]): number {
  const fromScore = rows
    .map((r) => r.efficiency)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0)
    // Whoop reports a percentage; tolerate a 0–1 ratio too.
    .map((v) => (v > 1 ? v / 100 : v));
  let eff = median(fromScore);
  if (eff == null) {
    eff = median(
      rows
        .map((r) => {
          const a = actualSleepMs(r);
          return a != null && r.in_bed_ms && r.in_bed_ms > 0 ? a / r.in_bed_ms : null;
        })
        .filter((v): v is number => v != null && v > 0),
    );
  }
  return Math.min(1, Math.max(0.7, eff ?? DEFAULT_EFFICIENCY));
}

/**
 * Median bedtime of the nights whose recovery was at or above the median —
 * but only when the bedtime/recovery regression says earlier is better.
 */
function recoveryBedtime(nights: Night[], recovery: RecoveryRow[]): number | null {
  const corr = computeBedtimeRecoveryCorr(
    nights.map((n) => n.row),
    recovery,
  );
  if (!corr || corr.correlation > RECOVERY_CORR_THRESHOLD) return null;
  const recByDate = new Map<string, number>();
  for (const r of recovery) if (r.recovery_score != null) recByDate.set(r.date, r.recovery_score);
  const paired = nights
    .map((n) => ({ bed: n.bedMin, rec: recByDate.get(n.date) }))
    .filter((p): p is { bed: number; rec: number } => p.rec != null);
  if (paired.length < SLEEP_PLAN_MIN_NIGHTS) return null;
  const medRec = median(paired.map((p) => p.rec))!;
  const good = paired.filter((p) => p.rec >= medRec).map((p) => p.bed);
  return circularMedianMinutes(good);
}

function hours(ms: number): string {
  return (Math.round((ms / MS_PER_HOUR) * 10) / 10).toFixed(1);
}

export function computeSleepPlan(
  sleep: SleepRow[],
  recovery: RecoveryRow[],
  /** Calendar date of "tonight" (the bed day), local `YYYY-MM-DD`. */
  tonight: string,
  offsetAt: OffsetAt = serverOffsetAt,
): SleepPlan {
  // Only nights that ended on or before tonight's date are history.
  const all = toNights(sleep).filter((n) => n.date <= tonight);
  if (all.length < SLEEP_PLAN_MIN_NIGHTS) {
    return { status: "insufficient", nights: all.length, needed: SLEEP_PLAN_MIN_NIGHTS };
  }

  const wakeWindow = all.slice(-WAKE_WINDOW_NIGHTS);
  const debtWindow = all.slice(-DEBT_WINDOW_NIGHTS);
  const wakeTimes = wakeWindow.map((n) => n.wakeMin);
  const wakeMin = circularMedianMinutes(wakeTimes)!;
  const wakeSpreadMin = circularMad(wakeTimes, wakeMin);
  const irregular = wakeSpreadMin > IRREGULAR_MAD_MIN;

  // Sleep need.
  let needSource: SleepPlanReady["needSource"] = "baseline";
  let baselineNeedMs = recentMedian(debtWindow.map((n) => n.row), (r) => r.need_from_baseline_ms);
  if (baselineNeedMs == null) {
    needSource = "sleep_need";
    // sleep_need_ms already folds in debt/strain; using it as the base and
    // then adding payback would double-count, so payback is skipped below.
    baselineNeedMs = recentMedian(debtWindow.map((n) => n.row), (r) => r.sleep_need_ms);
  }
  if (baselineNeedMs == null) {
    needSource = "default";
    baselineNeedMs = DEFAULT_NEED_MS;
  }

  const debtMs = debtWindow.reduce((s, n) => s + nightlyDebtMs(n.row), 0);
  const paybackMs =
    needSource === "sleep_need" ? 0 : Math.min(MAX_PAYBACK_MS, debtMs * PAYBACK_FRACTION);
  const targetSleepMs = baselineNeedMs + paybackMs;
  const efficiency = typicalEfficiency(wakeWindow.map((n) => n.row));
  const inBedMin = targetSleepMs / efficiency / MS_PER_MIN;

  // Wall-clock bedtime, DST-corrected. Wall = UTC + offset, so
  // elapsed = (wake − bed) − (offWake − offBed). Solve for bed, then refine
  // once because the bed-side offset depends on the bed time itself.
  const wakeDate = addDays(tonight, 1);
  const offWake = offsetAt(wakeDate, wakeMin);
  const wakeAbs = MIN_PER_DAY + wakeMin; // minutes from tonight 00:00
  let bedAbs = wakeAbs - inBedMin;
  let dstShiftMin = 0;
  for (let i = 0; i < 2; i++) {
    const bedDate = addDays(tonight, Math.floor(bedAbs / MIN_PER_DAY));
    const offBed = offsetAt(bedDate, wrapMinutes(bedAbs));
    dstShiftMin = offWake - offBed;
    bedAbs = wakeAbs - inBedMin - dstShiftMin;
  }

  let bedtimeMin = wrapMinutes(bedAbs);
  let timeInBedMin = inBedMin;

  const recBed = recoveryBedtime(all.slice(-SLEEP_PLAN_LOOKBACK_DAYS), recovery);
  let recoveryBedtimeMin: number | null = null;
  if (recBed != null) {
    const earlierBy = circularDiff(bedtimeMin, recBed); // + when recBed is earlier
    if (earlierBy > 0) {
      recoveryBedtimeMin = recBed;
      const pull = Math.min(earlierBy, MAX_RECOVERY_PULL_MIN);
      bedAbs -= pull;
      bedtimeMin = wrapMinutes(bedAbs);
      timeInBedMin += pull;
    }
  }

  const timeInBedMs = timeInBedMin * MS_PER_MIN;
  const yieldSleepMs = timeInBedMs * efficiency;
  const bedtimeAfterMidnight = bedAbs >= MIN_PER_DAY;

  const parts: string[] = [];
  if (needSource === "default") {
    parts.push("no Whoop sleep need on record, so assuming 8.0 h");
  } else if (debtMs >= 6 * MS_PER_MIN) {
    parts.push(`carrying ${hours(debtMs)} h of sleep debt`);
  } else {
    parts.push("no meaningful sleep debt this week");
  }
  if (recoveryBedtimeMin != null) {
    parts.push(`your recovery is highest when you are in bed before ${formatClock(recoveryBedtimeMin)}`);
  }
  if (irregular) {
    parts.push(`your wake time varies by about ±${Math.round(wakeSpreadMin)} min, so treat this as a rough guide`);
  }
  if (dstShiftMin !== 0) {
    parts.push(
      dstShiftMin > 0
        ? `clocks go forward tonight, so you lose ${dstShiftMin} min`
        : `clocks go back tonight, so you gain ${-dstShiftMin} min`,
    );
  }
  const reason = parts.join("; ").replace(/^./, (c) => c.toUpperCase());

  const strip = all.slice(-7).map((n) => ({
    date: n.date,
    bedDate: n.bedDate,
    bedMin: n.bedMin,
    deltaMin: Math.round(circularDiff(n.bedMin, bedtimeMin)),
  }));

  return {
    status: "ready",
    nights: wakeWindow.length,
    wakeDate,
    wakeMin,
    bedtimeMin,
    bedtimeAfterMidnight,
    windDownMin: wrapMinutes(bedtimeMin - WIND_DOWN_MIN),
    timeInBedMs,
    yieldSleepMs,
    targetSleepMs,
    baselineNeedMs,
    needSource,
    debtMs,
    paybackMs,
    efficiency,
    irregular,
    wakeSpreadMin,
    recoveryBedtimeMin,
    dstShiftMin,
    reason,
    strip,
  };
}
