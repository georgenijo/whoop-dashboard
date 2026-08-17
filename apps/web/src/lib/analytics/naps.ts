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

/** Next local calendar date, as a "YYYY-MM-DD" string. UTC-anchored so it's
 *  independent of the caller's tz — the input is already a local date
 *  string; this just walks it forward one whole day. */
function nextDateStr(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function computeNapImpact(naps: NapRow[], sleep: SleepRow[]): NapImpact {
  // The night sleep Whoop credits for a nap taken on date D (via
  // `need_from_nap_ms`) is the sleep that starts the evening of D and ends
  // the morning of D+1 — that night is now dated D+1 under wake-day
  // attribution (issue #440), not D. Pre-fix, `sleep.date` was the BED day,
  // so matching directly against the nap's own date (D) was correct; post-
  // fix the credited night has moved a day later, so the match set shifts
  // to nextDateStr(nap.date).
  const nightDates = new Set(naps.map((n) => nextDateStr(n.date)));

  const totalNaps = naps.length;
  const avgDurationMin = totalNaps > 0
    ? naps.reduce((a, n) => a + napDurationMs(n), 0) / totalNaps / MS_PER_MIN
    : 0;

  const napCredits = sleep
    .filter((s) => nightDates.has(s.date))
    .map((s) => s.need_from_nap_ms)
    .filter((v): v is number => v != null && v < 0);
  const avgSleepNeedReductionHrs = napCredits.length > 0
    ? -napCredits.reduce((a, b) => a + b, 0) / napCredits.length / MS_PER_HOUR
    : null;

  const withSleep = sleep.filter((s) => nightDates.has(s.date));
  const withoutSleep = sleep.filter((s) => !nightDates.has(s.date));

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
