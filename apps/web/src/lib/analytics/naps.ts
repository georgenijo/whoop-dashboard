import "server-only";
import type { NapRow, SleepRow } from "@/lib/db";

const MS_PER_HOUR = 3_600_000;
const MS_PER_MIN = 60_000;

function napDurationMs(n: NapRow): number {
  return (n.light_ms ?? 0) + (n.deep_ms ?? 0) + (n.rem_ms ?? 0);
}

function parseStartHour(start_local: string | null): number | null {
  if (!start_local) return null;
  const m = start_local.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
}

export type NapWithStartHour = NapRow & { start_hour: number | null };

export function withStartHour(naps: NapRow[]): NapWithStartHour[] {
  return naps.map((n) => ({ ...n, start_hour: parseStartHour(n.start_local) }));
}

export type NapImpactSide = {
  perf: number | null;
  eff: number | null;
  deepHrs: number | null;
  n: number;
};

export type NapImpact = {
  totalNaps: number;
  avgDurationMin: number;
  avgSleepNeedReductionHrs: number | null;
  withNap: NapImpactSide;
  withoutNap: NapImpactSide;
};

function avgOrNull(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

export function computeNapImpact(naps: NapRow[], sleep: SleepRow[]): NapImpact {
  const napDates = new Set(naps.map((n) => n.date));

  const totalNaps = naps.length;
  const avgDurationMin = totalNaps > 0
    ? naps.reduce((a, n) => a + napDurationMs(n), 0) / totalNaps / MS_PER_MIN
    : 0;

  const napCredits = sleep
    .filter((s) => napDates.has(s.date))
    .map((s) => s.need_from_nap_ms)
    .filter((v): v is number => v != null && v < 0);
  const avgSleepNeedReductionHrs = napCredits.length > 0
    ? -napCredits.reduce((a, b) => a + b, 0) / napCredits.length / MS_PER_HOUR
    : null;

  const withSleep = sleep.filter((s) => napDates.has(s.date));
  const withoutSleep = sleep.filter((s) => !napDates.has(s.date));

  function side(group: SleepRow[]): NapImpactSide {
    return {
      perf: avgOrNull(group.map((s) => s.performance)),
      eff: avgOrNull(group.map((s) => s.efficiency)),
      deepHrs: (() => {
        const v = avgOrNull(group.map((s) => s.deep_ms));
        return v == null ? null : v / MS_PER_HOUR;
      })(),
      n: group.length,
    };
  }

  return {
    totalNaps,
    avgDurationMin,
    avgSleepNeedReductionHrs,
    withNap: side(withSleep),
    withoutNap: side(withoutSleep),
  };
}
