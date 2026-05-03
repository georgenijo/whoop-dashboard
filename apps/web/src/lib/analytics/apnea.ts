import "server-only";
import type { RecoveryRow, SleepRow } from "@/lib/db";

export type ApneaRow = {
  date: string;
  apnea_score: number;
  apnea_score_7d: number;
  flag_disturbances: 0 | 1;
  flag_spo2: 0 | 1;
  flag_resp_rate: 0 | 1;
  flag_deep_sleep: 0 | 1;
  has_spo2: boolean;
};

const MS_PER_HOUR = 1000 * 60 * 60;

export function computeApneaSignal(
  sleep: SleepRow[],
  recovery: RecoveryRow[],
): ApneaRow[] {
  if (sleep.length === 0) return [];

  const sorted = [...sleep].sort((a, b) => a.date.localeCompare(b.date));
  const spo2ByDate = new Map<string, number | null>();
  for (const r of recovery) spo2ByDate.set(r.date, r.spo2);

  let respSum = 0;
  let respCount = 0;

  const interim = sorted.map((row) => {
    const baseline =
      respCount >= 3 ? respSum / respCount : null;

    const totalSleepHrs =
      row.in_bed_ms != null && row.awake_ms != null
        ? (row.in_bed_ms - row.awake_ms) / MS_PER_HOUR
        : null;
    const deepSleepPct =
      totalSleepHrs != null && totalSleepHrs > 0 && row.deep_ms != null
        ? (row.deep_ms / MS_PER_HOUR / totalSleepHrs) * 100
        : null;

    const spo2 = spo2ByDate.get(row.date) ?? null;
    const has_spo2 = spo2 != null;

    const flag_disturbances: 0 | 1 =
      row.disturbances != null && row.disturbances > 10 ? 1 : 0;
    const flag_spo2: 0 | 1 = spo2 != null && spo2 < 95 ? 1 : 0;
    const flag_resp_rate: 0 | 1 =
      row.respiratory_rate != null &&
      baseline != null &&
      row.respiratory_rate > baseline + 2
        ? 1
        : 0;
    const flag_deep_sleep: 0 | 1 =
      deepSleepPct != null && deepSleepPct < 15 ? 1 : 0;

    if (row.respiratory_rate != null && Number.isFinite(row.respiratory_rate)) {
      respSum += row.respiratory_rate;
      respCount += 1;
    }

    const apnea_score =
      flag_disturbances + flag_spo2 + flag_resp_rate + flag_deep_sleep;

    return {
      date: row.date,
      apnea_score,
      flag_disturbances,
      flag_spo2,
      flag_resp_rate,
      flag_deep_sleep,
      has_spo2,
    };
  });

  return interim.map((r, i) => {
    const start = Math.max(0, i - 6);
    let sum = 0;
    for (let j = start; j <= i; j++) sum += interim[j].apnea_score;
    return { ...r, apnea_score_7d: sum };
  });
}

export function apneaScoreLabel(score: number): "Low" | "Moderate" | "High" {
  if (score === 0) return "Low";
  if (score <= 2) return "Moderate";
  return "High";
}

export function rollingScoreColor(value: number): string {
  if (value <= 3) return "#00d4aa";
  if (value <= 7) return "#ffaa00";
  if (value <= 14) return "#ff8c00";
  return "#ff4444";
}

export function highRiskNightsCount(rows: ApneaRow[], windowDays = 14): number {
  if (rows.length === 0) return 0;
  const lastDate = rows[rows.length - 1].date;
  const cutoff = new Date(lastDate + "T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return rows.filter((r) => r.date >= cutoffStr && r.apnea_score >= 2).length;
}
