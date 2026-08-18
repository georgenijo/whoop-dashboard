import type { RecoveryRow } from "@/lib/db/recovery";
import type { SleepRow } from "@/lib/db/sleep";

const BEDTIME_ANCHOR = 20;
const WAKE_ANCHOR = 0;

function parseLocalParts(s: string | null): { date: string; hours: number } | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const hours = Number(m[4]) + Number(m[5]) / 60 + Number(m[6]) / 3600;
  return { date, hours };
}

function bedtimeHourFromAnchor(s: string | null): number | null {
  const parts = parseLocalParts(s);
  if (!parts) return null;
  return ((parts.hours - BEDTIME_ANCHOR + 24) % 24);
}

function wakeHourFromAnchor(s: string | null): number | null {
  const parts = parseLocalParts(s);
  if (!parts) return null;
  return ((parts.hours - WAKE_ANCHOR + 24) % 24);
}

export type RegressionPoint = { x: number; y: number };

export type Regression = {
  slope: number;
  intercept: number;
  correlation: number;
};

export function linearRegression(points: RegressionPoint[]): Regression | null {
  const n = points.length;
  if (n < 2) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXX += p.x * p.x;
    sumYY += p.y * p.y;
    sumXY += p.x * p.y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const varX = sumXX - n * meanX * meanX;
  const varY = sumYY - n * meanY * meanY;
  if (varX <= 0 || varY <= 0) return null;
  const cov = sumXY - n * meanX * meanY;
  const slope = cov / varX;
  const intercept = meanY - slope * meanX;
  const correlation = cov / Math.sqrt(varX * varY);
  return { slope, intercept, correlation };
}

export type BedtimeRecoveryPoint = {
  date: string;
  bt_dev_min: number;
  recovery: number;
};

export type BedtimeRecoveryResult = {
  points: BedtimeRecoveryPoint[];
  correlation: number;
  slope: number;
  intercept: number;
};

export function computeBedtimeRecoveryCorr(
  sleep: SleepRow[],
  recovery: RecoveryRow[],
): BedtimeRecoveryResult | null {
  const recoveryByDate = new Map<string, number>();
  for (const r of recovery) {
    if (r.recovery_score != null) recoveryByDate.set(r.date, r.recovery_score);
  }

  const valid: { date: string; bedtime: number; sameNightRecovery: number }[] = [];
  for (const s of sleep) {
    const bedtime = bedtimeHourFromAnchor(s.start_local);
    if (bedtime == null) continue;
    // `s.date` is now the WAKE day (issue #440 — sleepSummaryDate keys on
    // `end`, not `start`), which is exactly the date `recoverySummaryDate`
    // uses (recovery is created when the sleep ends). No date-shift needed:
    // this used to be `recoveryByDate.get(nextDate(s.date))` back when
    // `s.date` was the BED day and recovery landed the day after. Left as
    // `nextDate` post-fix, this paired every night's bedtime with the
    // FOLLOWING night's recovery instead of its own.
    const rec = recoveryByDate.get(s.date);
    if (rec == null) continue;
    valid.push({ date: s.date, bedtime, sameNightRecovery: rec });
  }

  if (valid.length < 5) return null;

  const meanBedtime = valid.reduce((a, b) => a + b.bedtime, 0) / valid.length;

  const points: BedtimeRecoveryPoint[] = valid.map((v) => ({
    date: v.date,
    bt_dev_min: (v.bedtime - meanBedtime) * 60,
    recovery: v.sameNightRecovery,
  }));

  const reg = linearRegression(points.map((p) => ({ x: p.bt_dev_min, y: p.recovery })));
  if (!reg) return null;

  return {
    points,
    correlation: reg.correlation,
    slope: reg.slope,
    intercept: reg.intercept,
  };
}

export type BedtimePatternsResult = {
  bedtime_std_min: number;
  wake_std_min: number;
  social_jet_lag_min: number;
  weekday: { avgBedtimeHour: number; avgWakeHour: number; avgSleepHrs: number; n: number };
  weekend: { avgBedtimeHour: number; avgWakeHour: number; avgSleepHrs: number; n: number };
  series: {
    /** Wake day — matches `sleep.date` (issue #440), drives the x-axis
     *  position and the weekday/weekend split. */
    date: string;
    /** Calendar date of the bedtime clock time itself — may be the day
     *  BEFORE `date` for a midnight-spanning night. Exists so a tooltip can
     *  show a clock time next to the day it actually happened on, instead
     *  of implying it happened on the wake day. */
    bedDate: string;
    bedtimeHour: number;
    rolling7: number | null;
  }[];
};

function dayOfWeek(date: string): number {
  return new Date(date + "T00:00:00").getDay();
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return Math.sqrt(variance);
}

export function computeBedtimePatterns(sleep: SleepRow[]): BedtimePatternsResult | null {
  const valid: {
    date: string;
    bedDate: string;
    bedtime: number;
    wake: number;
    sleepHrs: number;
    weekend: boolean;
  }[] = [];

  for (const s of sleep) {
    const bedtime = bedtimeHourFromAnchor(s.start_local);
    const wake = wakeHourFromAnchor(s.end_local);
    const startParts = parseLocalParts(s.start_local);
    const endParts = parseLocalParts(s.end_local);
    if (
      bedtime == null ||
      wake == null ||
      !startParts ||
      !endParts
    ) {
      continue;
    }
    const startMs = new Date(`${startParts.date}T00:00:00Z`).getTime() + startParts.hours * 3_600_000;
    const endMs = new Date(`${endParts.date}T00:00:00Z`).getTime() + endParts.hours * 3_600_000;
    const sleepHrs = (endMs - startMs) / 3_600_000;
    if (sleepHrs <= 0 || sleepHrs > 16) continue;
    const dow = dayOfWeek(s.date);
    valid.push({
      date: s.date,
      bedDate: startParts.date,
      bedtime,
      wake,
      sleepHrs,
      weekend: dow === 0 || dow === 6,
    });
  }

  if (valid.length < 5) return null;

  const bedtimes = valid.map((v) => v.bedtime);
  const wakes = valid.map((v) => v.wake);
  const bedtime_std_min = stddev(bedtimes) * 60;
  const wake_std_min = stddev(wakes) * 60;

  const wd = valid.filter((v) => !v.weekend);
  const we = valid.filter((v) => v.weekend);

  function summarize(arr: typeof valid) {
    if (arr.length === 0) {
      return { avgBedtimeHour: 0, avgWakeHour: 0, avgSleepHrs: 0, n: 0 };
    }
    const avgBed = arr.reduce((a, b) => a + b.bedtime, 0) / arr.length;
    const avgWake = arr.reduce((a, b) => a + b.wake, 0) / arr.length;
    const avgSleep = arr.reduce((a, b) => a + b.sleepHrs, 0) / arr.length;
    return {
      avgBedtimeHour: ((avgBed + BEDTIME_ANCHOR) % 24),
      avgWakeHour: ((avgWake + WAKE_ANCHOR) % 24),
      avgSleepHrs: avgSleep,
      n: arr.length,
    };
  }

  const weekday = summarize(wd);
  const weekend = summarize(we);

  let social_jet_lag_min = 0;
  if (wd.length > 0 && we.length > 0) {
    const wdMid = wd.reduce((a, b) => a + b.bedtime + b.sleepHrs / 2, 0) / wd.length;
    const weMid = we.reduce((a, b) => a + b.bedtime + b.sleepHrs / 2, 0) / we.length;
    social_jet_lag_min = (weMid - wdMid) * 60;
  }

  const series = valid.map((v, i) => {
    const start = Math.max(0, i - 6);
    let sum = 0;
    let count = 0;
    for (let j = start; j <= i; j++) {
      sum += valid[j].bedtime;
      count += 1;
    }
    return {
      date: v.date,
      bedDate: v.bedDate,
      bedtimeHour: v.bedtime,
      rolling7: count > 0 ? sum / count : null,
    };
  });

  return {
    bedtime_std_min,
    wake_std_min,
    social_jet_lag_min,
    weekday,
    weekend,
    series,
  };
}

export const BEDTIME_ANCHOR_HOUR = BEDTIME_ANCHOR;
export const WAKE_ANCHOR_HOUR = WAKE_ANCHOR;
