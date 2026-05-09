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
const FALLBACK_LOOKBACK_DAYS = 7;

type DashboardTodayResponse = {
  requested_date: string;
  // The date whose data is actually returned. Null only when no data exists in the
  // 7-day lookback window — i.e., a genuinely empty DB / fresh install.
  data_date: string | null;
  is_fallback: boolean;
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
    ots: { score: 0 | 1 | 2 | 3; severity: string } | null;
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

function buildDashboardToday(requestedDate: string): DashboardTodayResponse {
  // One range query per table over the widest window we may need:
  //   [requested - (SIGNAL_LOOKBACK + FALLBACK_LOOKBACK), requested]
  // This single fetch covers (a) the requested-day lookup, (b) the 7-day fallback
  // search, and (c) up to 45 days of history anchored to whichever data_date we
  // resolve to. No second round-trip is needed even when fallback fires.
  const historyStart = addDays(
    requestedDate,
    -(SIGNAL_LOOKBACK_DAYS + FALLBACK_LOOKBACK_DAYS),
  );
  const recoveryWindow = getRecoveryRange(historyStart, requestedDate);
  const sleepWindow = getSleepRange(historyStart, requestedDate);
  const strainWindow = getStrainRange(historyStart, requestedDate);

  const requestedHasData =
    findOnDate(recoveryWindow, requestedDate) !== null ||
    findOnDate(sleepWindow, requestedDate) !== null ||
    findOnDate(strainWindow, requestedDate) !== null;

  const dataDate = requestedHasData
    ? requestedDate
    : findFallbackDate(requestedDate, recoveryWindow, sleepWindow, strainWindow);

  if (dataDate === null) {
    // 7-day window completely empty — fresh install / wiped DB. Surface the
    // genuine empty state without a fallback marker.
    return {
      requested_date: requestedDate,
      data_date: null,
      is_fallback: false,
      recovery: null,
      sleep: null,
      strain: null,
      signals: { ots: null, illness: null, apnea: null },
    };
  }

  const recovery = findOnDate(recoveryWindow, dataDate);
  const sleep = findOnDate(sleepWindow, dataDate);
  const strain = findOnDate(strainWindow, dataDate);

  // Slice each table's history to the SIGNAL_LOOKBACK window anchored on dataDate.
  // The original fetch start is far enough back that this slice is always populated.
  const signalStart = addDays(dataDate, -SIGNAL_LOOKBACK_DAYS);
  const recoveryHistory = sliceWithin(recoveryWindow, signalStart, dataDate);
  const sleepHistory = sliceWithin(sleepWindow, signalStart, dataDate);
  const strainHistory = sliceWithin(strainWindow, signalStart, dataDate);

  return {
    requested_date: requestedDate,
    data_date: dataDate,
    is_fallback: dataDate !== requestedDate,
    recovery: recovery ? shapeRecovery(recovery) : null,
    sleep: sleep ? shapeSleep(sleep) : null,
    strain: strain ? shapeStrain(strain) : null,
    signals: {
      ots: shapeOTS(dataDate, recovery, strain, recoveryHistory, strainHistory),
      illness: shapeIllness(dataDate, recovery, recoveryHistory, sleepHistory),
      apnea: shapeApnea(dataDate, sleep, sleepHistory, recoveryHistory),
    },
  };
}

/**
 * Walks back up to FALLBACK_LOOKBACK_DAYS from `requested - 1d` and returns the
 * MAX date that appears in any of the three windows. Returns null if every day
 * in the lookback range is empty across recovery, sleep, and cycles.
 */
function findFallbackDate(
  requested: string,
  recovery: RecoveryRow[],
  sleep: SleepRow[],
  strain: CycleRow[],
): string | null {
  const lookbackStart = addDays(requested, -FALLBACK_LOOKBACK_DAYS);
  const lookbackEnd = addDays(requested, -1);
  const present = new Set<string>();
  for (const r of recovery) {
    if (r.date >= lookbackStart && r.date <= lookbackEnd) present.add(r.date);
  }
  for (const s of sleep) {
    if (s.date >= lookbackStart && s.date <= lookbackEnd) present.add(s.date);
  }
  for (const c of strain) {
    if (c.date >= lookbackStart && c.date <= lookbackEnd) present.add(c.date);
  }
  if (present.size === 0) return null;
  let max: string | null = null;
  for (const d of present) {
    if (max === null || d > max) max = d;
  }
  return max;
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

function findOnDate<T extends { date: string }>(rows: T[], date: string): T | null {
  for (const r of rows) if (r.date === date) return r;
  return null;
}

function sliceWithin<T extends { date: string }>(rows: T[], start: string, end: string): T[] {
  const out: T[] = [];
  for (const r of rows) if (r.date >= start && r.date <= end) out.push(r);
  return out;
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
