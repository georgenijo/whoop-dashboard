import { requireAuth } from "@/lib/auth";
import {
  getRecoveryRange,
  getSleepRange,
  getStrainRange,
  type CycleRow,
  type RecoveryRow,
  type SleepRow,
} from "@/lib/db";
import { computeApneaSignal, highRiskNightsCount } from "@/lib/analytics/apnea";
import { computeIllnessSignal, type IllnessRow } from "@/lib/analytics/illness";
import { computeOTS } from "@/lib/analytics/ots";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_MINUTE = 60_000;
const SIGNAL_LOOKBACK_DAYS = 45;

type DashboardTodayResponse = {
  date: string;
  recovery: {
    score: number | null;
    hrv_ms: number | null;
    rhr_bpm: number | null;
    spo2_pct: number | null;
    skin_temp_c: number | null;
  } | null;
  sleep: {
    duration_min: number | null;
    perf_pct: number | null;
    efficiency_pct: number | null;
    debt_min: number | null;
  } | null;
  strain: {
    score: number | null;
    kj: number | null;
    avg_hr: number | null;
    max_hr: number | null;
  } | null;
  signals: {
    ots: { score: number; severity: string } | null;
    illness: { risk: string } | null;
    apnea: { high_risk_nights_7d: number } | null;
  };
};

export async function GET(req: Request) {
  try {
    await requireAuth(req);
    const date = parseDateParam(req);
    if (!date) {
      return Response.json({ error: "Invalid date. Expected YYYY-MM-DD." }, { status: 400 });
    }
    return Response.json(buildDashboardToday(date));
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

function buildDashboardToday(date: string): DashboardTodayResponse {
  const recovery = first(getRecoveryRange(date, date));
  const sleep = first(getSleepRange(date, date));
  const strain = first(getStrainRange(date, date));

  const historyStart = addDays(date, -SIGNAL_LOOKBACK_DAYS);
  const recoveryHistory = getRecoveryRange(historyStart, date);
  const sleepHistory = getSleepRange(historyStart, date);
  const strainHistory = getStrainRange(historyStart, date);

  return {
    date,
    recovery: recovery ? shapeRecovery(recovery) : null,
    sleep: sleep ? shapeSleep(sleep) : null,
    strain: strain ? shapeStrain(strain) : null,
    signals: {
      ots: shapeOTS(date, recovery, strain, recoveryHistory, strainHistory),
      illness: shapeIllness(date, recovery, recoveryHistory, sleepHistory),
      apnea: shapeApnea(date, sleep, sleepHistory, recoveryHistory),
    },
  };
}

function parseDateParam(req: Request): string | null {
  const value = new URL(req.url).searchParams.get("date");
  if (value === null || value === "") return localToday();
  return isValidDate(value) ? value : null;
}

function localToday(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function first<T>(rows: T[]): T | null {
  return rows.length > 0 ? rows[0] : null;
}

function finiteOrNull(value: number | null): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function msToRoundedMinutes(value: number | null): number | null {
  return value != null && Number.isFinite(value) ? Math.round(value / MS_PER_MINUTE) : null;
}

function sleepStageMs(row: SleepRow): number | null {
  const stages = [row.light_ms, row.deep_ms, row.rem_ms];
  if (stages.every((v) => v == null)) return null;
  let sum = 0;
  for (const value of stages) sum += value ?? 0;
  return sum;
}

function shapeRecovery(row: RecoveryRow): DashboardTodayResponse["recovery"] {
  return {
    score: finiteOrNull(row.recovery_score),
    hrv_ms: finiteOrNull(row.hrv),
    rhr_bpm: finiteOrNull(row.rhr),
    spo2_pct: finiteOrNull(row.spo2),
    skin_temp_c: finiteOrNull(row.skin_temp),
  };
}

function shapeSleep(row: SleepRow): DashboardTodayResponse["sleep"] {
  const sleptMs = sleepStageMs(row);
  const debtMs =
    row.sleep_need_ms != null && sleptMs != null
      ? Math.max(0, row.sleep_need_ms - sleptMs)
      : null;

  return {
    duration_min: msToRoundedMinutes(row.in_bed_ms),
    perf_pct: finiteOrNull(row.performance),
    efficiency_pct: finiteOrNull(row.efficiency),
    debt_min: msToRoundedMinutes(debtMs),
  };
}

function shapeStrain(row: CycleRow): DashboardTodayResponse["strain"] {
  return {
    score: finiteOrNull(row.strain),
    kj: finiteOrNull(row.kilojoule),
    avg_hr: finiteOrNull(row.avg_hr),
    max_hr: finiteOrNull(row.max_hr),
  };
}

function shapeOTS(
  date: string,
  recovery: RecoveryRow | null,
  strain: CycleRow | null,
  recoveryHistory: RecoveryRow[],
  strainHistory: CycleRow[],
): DashboardTodayResponse["signals"]["ots"] {
  if (recovery?.date !== date || strain?.date !== date) return null;
  const result = computeOTS(recoveryHistory, strainHistory);
  if (!result) return null;
  return { score: result.score, severity: result.level };
}

function shapeIllness(
  date: string,
  recovery: RecoveryRow | null,
  recoveryHistory: RecoveryRow[],
  sleepHistory: SleepRow[],
): DashboardTodayResponse["signals"]["illness"] {
  if (recovery?.date !== date) return null;
  const rows = computeIllnessSignal(recoveryHistory, sleepHistory);
  const row = rows.find((r) => r.date === date);
  if (!row || row.rhr_baseline == null) return null;
  return { risk: illnessRisk(row) };
}

function illnessRisk(row: IllnessRow): string {
  if (row.signal_count >= 3) return "high";
  if (row.signal_count === 2) return "elevated";
  if (row.signal_count === 1) return "watch";
  return "low";
}

function shapeApnea(
  date: string,
  sleep: SleepRow | null,
  sleepHistory: SleepRow[],
  recoveryHistory: RecoveryRow[],
): DashboardTodayResponse["signals"]["apnea"] {
  if (sleep?.date !== date) return null;
  const rows = computeApneaSignal(sleepHistory, recoveryHistory);
  if (!rows.some((r) => r.date === date)) return null;
  return { high_risk_nights_7d: highRiskNightsCount(rows, 7) };
}
