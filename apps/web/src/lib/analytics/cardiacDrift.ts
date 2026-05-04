import "server-only";
import type { WorkoutRow } from "@/lib/db";

export type CardiacDriftSport = {
  sport: string;
  workout_count: number;
  date_span_days: number;
  median_duration_sec: number;
  slope: number;
  intercept: number;
  slope_per_28d: number;
  r_squared: number;
  drift_detected: boolean;
  dates: string[];
  avg_hrs: number[];
};

export type CardiacDriftBelowThreshold = {
  sport: string;
  reason: "too_few_workouts" | "too_short_span";
  workout_count: number;
  date_span_days: number;
};

export type CardiacDriftReport = {
  qualifying: CardiacDriftSport[];
  belowThreshold: CardiacDriftBelowThreshold[];
};

const MIN_WORKOUTS = 3;
const MIN_SPAN_DAYS = 28;
const DURATION_TOLERANCE = 0.25;
const DRIFT_BPM_PER_28D = 5;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

type Candidate = {
  date: string;
  ordinalDay: number;
  avg_hr: number;
  duration_sec: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function daysBetweenUTC(a: string, b: string): number {
  const ad = Date.UTC(
    Number(a.slice(0, 4)),
    Number(a.slice(5, 7)) - 1,
    Number(a.slice(8, 10)),
  );
  const bd = Date.UTC(
    Number(b.slice(0, 4)),
    Number(b.slice(5, 7)) - 1,
    Number(b.slice(8, 10)),
  );
  return Math.round((bd - ad) / MS_PER_DAY);
}

export function computeCardiacDrift(workouts: WorkoutRow[]): CardiacDriftReport {
  const bySport = new Map<string, WorkoutRow[]>();
  for (const w of workouts) {
    if (!w.sport) continue;
    const sport = w.sport.trim();
    if (!sport) continue;
    if (
      w.avg_hr == null ||
      !Number.isFinite(w.avg_hr) ||
      w.avg_hr <= 0 ||
      w.duration_sec == null ||
      !Number.isFinite(w.duration_sec) ||
      w.duration_sec <= 0
    ) {
      continue;
    }
    const arr = bySport.get(sport) ?? [];
    arr.push(w);
    bySport.set(sport, arr);
  }

  const qualifying: CardiacDriftSport[] = [];
  const belowThreshold: CardiacDriftBelowThreshold[] = [];

  for (const [sport, rows] of bySport) {
    const med = median(rows.map((r) => r.duration_sec as number));
    const lo = med * (1 - DURATION_TOLERANCE);
    const hi = med * (1 + DURATION_TOLERANCE);
    const matched = rows
      .filter((r) => {
        const d = r.duration_sec as number;
        return d >= lo && d <= hi;
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const span =
      matched.length > 0
        ? daysBetweenUTC(matched[0].date, matched[matched.length - 1].date)
        : 0;

    if (matched.length < MIN_WORKOUTS) {
      belowThreshold.push({
        sport,
        reason: "too_few_workouts",
        workout_count: matched.length,
        date_span_days: span,
      });
      continue;
    }
    if (span < MIN_SPAN_DAYS) {
      belowThreshold.push({
        sport,
        reason: "too_short_span",
        workout_count: matched.length,
        date_span_days: span,
      });
      continue;
    }

    const minDate = matched[0].date;
    const candidates: Candidate[] = matched.map((r) => ({
      date: r.date,
      ordinalDay: daysBetweenUTC(minDate, r.date),
      avg_hr: r.avg_hr as number,
      duration_sec: r.duration_sec as number,
    }));

    const n = candidates.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;
    for (const c of candidates) {
      sumX += c.ordinalDay;
      sumY += c.avg_hr;
      sumXY += c.ordinalDay * c.avg_hr;
      sumX2 += c.ordinalDay * c.ordinalDay;
    }
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) {
      belowThreshold.push({
        sport,
        reason: "too_short_span",
        workout_count: n,
        date_span_days: span,
      });
      continue;
    }
    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    const meanY = sumY / n;
    let ssTot = 0;
    let ssRes = 0;
    for (const c of candidates) {
      const dy = c.avg_hr - meanY;
      ssTot += dy * dy;
      const pred = intercept + slope * c.ordinalDay;
      const dr = c.avg_hr - pred;
      ssRes += dr * dr;
    }
    const r_squared = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
    const slope_per_28d = slope * 28;
    const drift_detected = slope_per_28d > DRIFT_BPM_PER_28D;

    qualifying.push({
      sport,
      workout_count: n,
      date_span_days: span,
      median_duration_sec: med,
      slope,
      intercept,
      slope_per_28d,
      r_squared,
      drift_detected,
      dates: candidates.map((c) => c.date),
      avg_hrs: candidates.map((c) => c.avg_hr),
    });
  }

  qualifying.sort((a, b) => {
    if (a.drift_detected !== b.drift_detected) return a.drift_detected ? -1 : 1;
    return Math.abs(b.slope_per_28d) - Math.abs(a.slope_per_28d);
  });
  belowThreshold.sort((a, b) => a.sport.localeCompare(b.sport));

  return { qualifying, belowThreshold };
}
