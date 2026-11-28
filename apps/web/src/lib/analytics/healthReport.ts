// Printable health summary (HEALTH_REPORT=1). Pure computation over rows the
// /report page has already read through the user-scoped `@/lib/db` readers.
// No DB, network or clock access happens here: `today` is passed in, so every
// edge case can be unit-tested with fixtures.
//
// The window is an inclusive run of calendar dates keyed on the same `date`
// column every other page uses (wake day for sleep and recovery, user-local
// day for cycles and workouts). All date math is on `YYYY-MM-DD` strings at
// UTC midnight, so a DST transition inside the window never adds or drops a
// day.

import type { RecoveryRow } from "@/lib/db/recovery";
import type { SleepRow } from "@/lib/db/sleep";
import type { CycleRow } from "@/lib/db/strain";
import type { WorkoutRow } from "@/lib/db/workouts";

/** The only period lengths `?days=` accepts. */
export const REPORT_DAY_OPTIONS = [7, 30, 90] as const;
export type ReportDays = (typeof REPORT_DAY_OPTIONS)[number];
export const DEFAULT_REPORT_DAYS: ReportDays = 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a raw `?days=` value against the allowlist. Anything else —
 * missing, repeated, padded, signed, fractional, or simply not 7/30/90 —
 * falls back to the default instead of erroring, so a bad link still prints.
 */
export function parseReportDays(raw: string | string[] | undefined): ReportDays {
  if (typeof raw !== "string" || !/^\d{1,3}$/.test(raw)) return DEFAULT_REPORT_DAYS;
  const n = Number(raw);
  return (REPORT_DAY_OPTIONS as readonly number[]).includes(n)
    ? (n as ReportDays)
    : DEFAULT_REPORT_DAYS;
}

/** `YYYY-MM-DD` shifted by whole calendar days (DST-proof: UTC midnight). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive window ending today: `days` = today plus the `days - 1` dates before it. */
export function reportWindow(today: string, days: ReportDays): { start: string; end: string } {
  if (!DATE_RE.test(today)) throw new Error(`invalid date: ${today}`);
  return { start: addDays(today, -(days - 1)), end: today };
}

export type Stat = {
  avg: number;
  min: number;
  max: number;
  /** Date of the (first) minimum / maximum value. */
  minDate: string;
  maxDate: string;
  /** Number of days that contributed a value. */
  n: number;
};

export type MetricKey =
  | "recovery"
  | "hrv"
  | "rhr"
  | "sleepHours"
  | "sleepEfficiency"
  | "sleepPerformance"
  | "strain"
  | "respiratoryRate"
  | "skinTemp";

export type MetricLine = {
  key: MetricKey;
  label: string;
  unit: string;
  decimals: number;
  /** null when no day in the window has a value. */
  stat: Stat | null;
};

export type NotableDay = { date: string; value: number };

export type Coverage = {
  days: number;
  recoveryDays: number;
  sleepNights: number;
  strainDays: number;
};

export type HealthReport = {
  days: ReportDays;
  start: string;
  end: string;
  coverage: Coverage;
  metrics: MetricLine[];
  /**
   * Largest absolute skin-temperature deviation from the period's own mean
   * (°C, signed). Null unless at least two days carry a reading.
   */
  skinTempMaxDeviation: NotableDay | null;
  workouts: { count: number; totalSec: number };
  notable: {
    bestRecovery: NotableDay | null;
    worstRecovery: NotableDay | null;
    longestSleep: NotableDay | null;
  };
  /** True when nothing at all was recorded in the window. */
  empty: boolean;
};

export type HealthReportInput = {
  today: string;
  days: ReportDays;
  recovery: readonly RecoveryRow[];
  sleep: readonly SleepRow[];
  cycles: readonly CycleRow[];
  workouts: readonly WorkoutRow[];
};

function finite(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Asleep time = light + deep + REM, matching the naps convention. Null if no stage is known. */
export function asleepMs(s: Pick<SleepRow, "light_ms" | "deep_ms" | "rem_ms">): number | null {
  const parts = [s.light_ms, s.deep_ms, s.rem_ms];
  if (!parts.some(finite)) return null;
  return parts.reduce<number>((sum, p) => sum + (finite(p) ? p : 0), 0);
}

/**
 * Keep rows inside [start, end] and collapse duplicate dates to the first
 * row seen. Readers already return one row per date for these tables; this is
 * defensive so a stray duplicate can never double-count a day.
 */
function inWindow<T extends { date: string }>(rows: readonly T[], start: string, end: string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (typeof r.date !== "string" || r.date < start || r.date > end) continue;
    if (seen.has(r.date)) continue;
    seen.add(r.date);
    out.push(r);
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Min/avg/max over finite values. Ties resolve to the earliest date. */
export function summarize(points: readonly { date: string; value: number | null }[]): Stat | null {
  const vals = points.filter((p): p is { date: string; value: number } => finite(p.value));
  if (vals.length === 0) return null;
  let min = vals[0];
  let max = vals[0];
  let sum = 0;
  for (const p of vals) {
    sum += p.value;
    if (p.value < min.value) min = p;
    if (p.value > max.value) max = p;
  }
  return {
    avg: sum / vals.length,
    min: min.value,
    max: max.value,
    minDate: min.date,
    maxDate: max.date,
    n: vals.length,
  };
}

export function computeHealthReport(input: HealthReportInput): HealthReport {
  const { start, end } = reportWindow(input.today, input.days);
  const recovery = inWindow(input.recovery, start, end);
  const sleep = inWindow(input.sleep, start, end);
  const cycles = inWindow(input.cycles, start, end);
  // Workouts are many per day: filter by window and dedupe by id, not date.
  const workoutIds = new Set<string>();
  const workouts = input.workouts.filter((w) => {
    if (typeof w.date !== "string" || w.date < start || w.date > end) return false;
    if (workoutIds.has(w.id)) return false;
    workoutIds.add(w.id);
    return true;
  });

  const pts = <T extends { date: string }>(rows: T[], pick: (r: T) => number | null) =>
    rows.map((r) => ({ date: r.date, value: pick(r) }));

  const recoveryStat = summarize(pts(recovery, (r) => r.recovery_score));
  const sleepHoursStat = summarize(
    pts(sleep, (s) => {
      const ms = asleepMs(s);
      return ms === null ? null : ms / 3_600_000;
    }),
  );
  const skinTempPoints = pts(recovery, (r) => r.skin_temp);
  const skinTempStat = summarize(skinTempPoints);

  const metrics: MetricLine[] = [
    { key: "recovery", label: "Recovery", unit: "%", decimals: 0, stat: recoveryStat },
    { key: "hrv", label: "HRV", unit: "ms", decimals: 0, stat: summarize(pts(recovery, (r) => r.hrv)) },
    { key: "rhr", label: "Resting heart rate", unit: "bpm", decimals: 0, stat: summarize(pts(recovery, (r) => r.rhr)) },
    { key: "sleepHours", label: "Sleep duration", unit: "h", decimals: 1, stat: sleepHoursStat },
    { key: "sleepEfficiency", label: "Sleep efficiency", unit: "%", decimals: 0, stat: summarize(pts(sleep, (s) => s.efficiency)) },
    { key: "sleepPerformance", label: "Sleep performance", unit: "%", decimals: 0, stat: summarize(pts(sleep, (s) => s.performance)) },
    { key: "strain", label: "Day strain", unit: "", decimals: 1, stat: summarize(pts(cycles, (c) => c.strain)) },
    { key: "respiratoryRate", label: "Respiratory rate", unit: "rpm", decimals: 1, stat: summarize(pts(sleep, (s) => s.respiratory_rate)) },
    { key: "skinTemp", label: "Skin temperature", unit: "°C", decimals: 1, stat: skinTempStat },
  ];

  let skinTempMaxDeviation: NotableDay | null = null;
  if (skinTempStat && skinTempStat.n >= 2) {
    for (const p of skinTempPoints) {
      if (!finite(p.value)) continue;
      const dev = p.value - skinTempStat.avg;
      if (!skinTempMaxDeviation || Math.abs(dev) > Math.abs(skinTempMaxDeviation.value)) {
        skinTempMaxDeviation = { date: p.date, value: dev };
      }
    }
  }

  const totalSec = workouts.reduce((s, w) => s + (finite(w.duration_sec) && w.duration_sec > 0 ? w.duration_sec : 0), 0);

  const coverage: Coverage = {
    days: input.days,
    recoveryDays: recoveryStat?.n ?? 0,
    sleepNights: sleepHoursStat?.n ?? 0,
    strainDays: metrics.find((m) => m.key === "strain")!.stat?.n ?? 0,
  };

  const empty =
    metrics.every((m) => m.stat === null) && workouts.length === 0;

  return {
    days: input.days,
    start,
    end,
    coverage,
    metrics,
    skinTempMaxDeviation,
    workouts: { count: workouts.length, totalSec },
    notable: {
      bestRecovery: recoveryStat ? { date: recoveryStat.maxDate, value: recoveryStat.max } : null,
      // With a single scored day best and worst are the same day; say so once.
      worstRecovery:
        recoveryStat && recoveryStat.n > 1 ? { date: recoveryStat.minDate, value: recoveryStat.min } : null,
      longestSleep: sleepHoursStat ? { date: sleepHoursStat.maxDate, value: sleepHoursStat.max } : null,
    },
    empty,
  };
}

/** "Fri, Nov 27, 2026" from `YYYY-MM-DD`, formatted at UTC so the server TZ can't shift it. */
export function formatReportDate(date: string, withYear = false): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/** "1 h 05 m" style duration from seconds. */
export function formatDuration(totalSec: number): string {
  const mins = Math.round(totalSec / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} m` : `${m} m`;
}
