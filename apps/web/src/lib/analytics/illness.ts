import "server-only";
import type { RecoveryRow, SleepRow } from "@/lib/db";

export type IllnessRow = {
  date: string;
  rhr: number | null;
  hrv: number | null;
  skin_temp: number | null;
  respiratory_rate: number | null;
  rhr_baseline: number | null;
  hrv_baseline: number | null;
  skin_temp_baseline: number | null;
  resp_rate_baseline: number | null;
  rhr_dev: number | null;
  hrv_dev: number | null;
  skin_temp_dev: number | null;
  resp_rate_dev: number | null;
  rhr_flag: boolean;
  hrv_flag: boolean;
  skin_temp_flag: boolean;
  resp_rate_flag: boolean;
  signal_count: number;
  has_skin_temp: boolean;
  illness_flag: boolean;
};

const WINDOW = 14;
const MIN_PERIODS = 7;

function rollingShiftedMean(values: (number | null)[]): (number | null)[] {
  // 14-day rolling mean with min_periods=7, then shifted by 1 (today excluded).
  // Mirrors pandas: df.rolling(14, min_periods=7).mean().shift(1)
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 1; i < values.length; i++) {
    const start = Math.max(0, i - WINDOW);
    let sum = 0;
    let count = 0;
    for (let j = start; j < i; j++) {
      const v = values[j];
      if (v != null && Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
    out[i] = count >= MIN_PERIODS ? sum / count : null;
  }
  return out;
}

export function computeIllnessSignal(
  recovery: RecoveryRow[],
  sleep: SleepRow[],
): IllnessRow[] {
  if (recovery.length === 0) return [];

  const sleepByDate = new Map<string, number | null>();
  for (const s of sleep) sleepByDate.set(s.date, s.respiratory_rate);

  const sorted = [...recovery].sort((a, b) => a.date.localeCompare(b.date));
  const dates = sorted.map((r) => r.date);
  const rhr = sorted.map((r) => r.rhr);
  const hrv = sorted.map((r) => r.hrv);
  const skinTemp = sorted.map((r) => r.skin_temp);
  const respRate = dates.map((d) => sleepByDate.get(d) ?? null);

  const rhrBase = rollingShiftedMean(rhr);
  const hrvBase = rollingShiftedMean(hrv);
  const skinBase = rollingShiftedMean(skinTemp);
  const respBase = rollingShiftedMean(respRate);

  return dates.map((date, i) => {
    const rhrV = rhr[i];
    const hrvV = hrv[i];
    const skinV = skinTemp[i];
    const respV = respRate[i];
    const rhrB = rhrBase[i];
    const hrvB = hrvBase[i];
    const skinB = skinBase[i];
    const respB = respBase[i];

    const rhrFlag = rhrV != null && rhrB != null && rhrV > rhrB + 3;
    const hrvFlag = hrvV != null && hrvB != null && hrvV < hrvB * 0.9;
    const skinFlag = skinV != null && skinB != null && skinV > skinB + 0.5;
    const respFlag = respV != null && respB != null && respV > respB + 2;

    const signalCount =
      (rhrFlag ? 1 : 0) + (hrvFlag ? 1 : 0) + (skinFlag ? 1 : 0);

    return {
      date,
      rhr: rhrV,
      hrv: hrvV,
      skin_temp: skinV,
      respiratory_rate: respV,
      rhr_baseline: rhrB,
      hrv_baseline: hrvB,
      skin_temp_baseline: skinB,
      resp_rate_baseline: respB,
      rhr_dev: rhrV != null && rhrB != null ? rhrV - rhrB : null,
      hrv_dev:
        hrvV != null && hrvB != null && hrvB !== 0
          ? ((hrvV - hrvB) / hrvB) * 100
          : null,
      skin_temp_dev: skinV != null && skinB != null ? skinV - skinB : null,
      resp_rate_dev: respV != null && respB != null ? respV - respB : null,
      rhr_flag: rhrFlag,
      hrv_flag: hrvFlag,
      skin_temp_flag: skinFlag,
      resp_rate_flag: respFlag,
      signal_count: signalCount,
      has_skin_temp: skinV != null,
      illness_flag: signalCount >= 2,
    };
  });
}
