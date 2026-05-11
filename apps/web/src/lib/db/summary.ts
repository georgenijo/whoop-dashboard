import "server-only";
import {
  type DB,
  hasColumn,
  hasTable,
  openWrite,
  safeDays,
  safeQuery,
} from "./connection";
import { forUser } from "./scoped";
import {
  type RecoveryRow,
  getLatestRecovery,
  getPreviousRecovery,
  getRecoveryTrend,
} from "./recovery";
import {
  type CycleRow,
  getLatestCycle,
  getPreviousCycle,
  getStrainTrend,
} from "./strain";
import {
  type SleepRow,
  getLatestSleep,
  getPreviousSleep,
  getSleepTrend,
} from "./sleep";
import { type WorkoutRow } from "./workouts";

export type DailySummaryRow = {
  date: string;
  recovery_score: number | null;
  hrv_ms: number | null;
  resting_hr: number | null;
  sleep_hours: number | null;
  sleep_efficiency: number | null;
  sleep_performance: number | null;
  day_strain: number | null;
  max_hr: number | null;
  avg_hr: number | null;
  kilojoules: number | null;
  workouts_count: number | null;
  computed_at: string;
};

export type InsightRow = {
  date: string;
  insight: string;
  created_at: string | null;
};

/** Convenience: 30-day sparklines for each KPI. Missing values become nulls. */
export type Overview = {
  latestRecovery: RecoveryRow | null;
  previousRecovery: RecoveryRow | null;
  latestCycle: CycleRow | null;
  previousCycle: CycleRow | null;
  latestSleep: SleepRow | null;
  previousSleep: SleepRow | null;
  recoveryTrend: RecoveryRow[];
  strainTrend: CycleRow[];
  sleepTrend: SleepRow[];
  hasData: boolean;
};

function isFiniteNum(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function rawTimestampMs(row: { date: string | null; raw: string | null }): number | null {
  if (row.raw) {
    try {
      const parsed = JSON.parse(row.raw) as Record<string, unknown>;
      for (const field of ["updated_at", "created_at", "end", "start"]) {
        const value = parsed[field];
        if (typeof value !== "string") continue;
        const ms = Date.parse(value);
        if (Number.isFinite(ms)) return ms;
      }
    } catch {
      // Fall back to the stored row date below.
    }
  }

  if (!row.date) return null;
  const ms = Date.parse(`${row.date}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

function latestTableTimestampMs(
  db: DB,
  userId: number,
  table: "recovery" | "cycles" | "sleep",
  extraWhere = "",
): number | null {
  if (!hasTable(db, table)) return null;
  const rawSelect = hasColumn(db, table, "raw") ? "raw" : "NULL AS raw";
  const where = extraWhere
    ? `WHERE ${extraWhere} AND user_id = ?`
    : `WHERE user_id = ?`;
  const row = db
    .prepare(
      `SELECT date, ${rawSelect} FROM ${table} ${where} ORDER BY date DESC LIMIT 1`,
    )
    .get(userId) as { date: string | null; raw: string | null } | undefined;
  return row ? rawTimestampMs(row) : null;
}

export function getLatestWhoopDataTimestamp(userId: number): string | null {
  // Uses forUser().read for the multi-table walk — we need three reads
  // sharing one DB handle, and the extra-WHERE patterns vary per table.
  // Each underlying SELECT still scopes via `WHERE user_id = ?`.
  return forUser(userId).read((db, uid) => {
    const sleepWhere =
      hasTable(db, "sleep") && hasColumn(db, "sleep", "nap")
        ? "COALESCE(nap, 0) = 0"
        : "";
    const timestamps = [
      latestTableTimestampMs(db, uid, "recovery"),
      latestTableTimestampMs(db, uid, "cycles"),
      latestTableTimestampMs(db, uid, "sleep", sleepWhere),
    ].filter((ms): ms is number => ms !== null);
    if (timestamps.length === 0) return null;
    return new Date(Math.max(...timestamps)).toISOString();
  });
}

export function getLatestInsight(): InsightRow | null {
  // Insights are a global table (no user_id today). Phase E follow-up if
  // per-user insights are needed.
  return safeQuery((db) => {
    if (!hasTable(db, "insights")) return null;
    const createdAt = hasColumn(db, "insights", "created_at")
      ? "created_at"
      : "NULL AS created_at";
    const row = db
      .prepare(`SELECT date, insight, ${createdAt} FROM insights ORDER BY date DESC LIMIT 1`)
      .get() as InsightRow | undefined;
    return row ?? null;
  });
}

export function saveInsight(date: string, insight: string): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      "INSERT INTO insights (date, insight, created_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET insight = excluded.insight, created_at = excluded.created_at"
    ).run(date, insight, new Date().toISOString());
  } finally {
    db.close();
  }
}

export function getDailySummary(
  userId: number,
  start: string,
  end: string,
): DailySummaryRow[] {
  return forUser(userId).all<DailySummaryRow>(
    "SELECT date, recovery_score, hrv_ms, resting_hr, sleep_hours, sleep_efficiency, sleep_performance, day_strain, max_hr, avg_hr, kilojoules, workouts_count, computed_at FROM daily_summary WHERE date BETWEEN ? AND ? AND user_id = ? ORDER BY date ASC",
    start,
    end,
  );
}

export function getOverview(userId: number, days = 30): Overview {
  const recoveryTrend = getRecoveryTrend(userId, days);
  const strainTrend = getStrainTrend(userId, days);
  const sleepTrend = getSleepTrend(userId, days);
  const latestRecovery = getLatestRecovery(userId);
  const latestCycle = getLatestCycle(userId);
  const latestSleep = getLatestSleep(userId);
  return {
    latestRecovery,
    previousRecovery: getPreviousRecovery(userId),
    latestCycle,
    previousCycle: getPreviousCycle(userId),
    latestSleep,
    previousSleep: getPreviousSleep(userId),
    recoveryTrend,
    strainTrend,
    sleepTrend,
    hasData: Boolean(latestRecovery || latestCycle || latestSleep),
  };
}


export function getHealthContext(userId: number, days = 30): string {
  const lines: string[] = [`=== WHOOP DATA (last ${days} days) ===\n`];
  const limit = safeDays(days);

  const recovery = forUser(userId).all<RecoveryRow>(
    `SELECT date, recovery_score, hrv, rhr, spo2, skin_temp FROM recovery WHERE user_id = ? ORDER BY date DESC LIMIT ${limit}`,
  );

  if (recovery.length) {
    lines.push("RECOVERY (newest first):");
    for (const r of recovery) {
      const score = isFiniteNum(r.recovery_score) ? `${r.recovery_score.toFixed(0)}%` : "n/a";
      const hrv = isFiniteNum(r.hrv) ? `${r.hrv.toFixed(1)}ms` : "n/a";
      const rhr = isFiniteNum(r.rhr) ? `${r.rhr.toFixed(0)}bpm` : "n/a";
      const spo2 = isFiniteNum(r.spo2) ? `, SpO2=${r.spo2}%` : "";
      const temp = isFiniteNum(r.skin_temp) ? `, Skin=${r.skin_temp}°C` : "";
      lines.push(
        `  ${r.date}: Recovery=${score}, HRV=${hrv}, RHR=${rhr}${spo2}${temp}`
      );
    }
    const scores = recovery.map((r) => r.recovery_score).filter(isFiniteNum);
    const hrvs = recovery.map((r) => r.hrv).filter(isFiniteNum);
    const rhrs = recovery.map((r) => r.rhr).filter(isFiniteNum);
    const avgScore = mean(scores);
    const avgHrv = mean(hrvs);
    const avgRhr = mean(rhrs);
    if (avgScore != null || avgHrv != null || avgRhr != null) {
      const parts: string[] = [];
      if (avgScore != null) parts.push(`Recovery=${avgScore.toFixed(1)}%`);
      if (avgHrv != null) parts.push(`HRV=${avgHrv.toFixed(1)}ms`);
      if (avgRhr != null) parts.push(`RHR=${avgRhr.toFixed(1)}bpm`);
      lines.push(`\n  Averages: ${parts.join(", ")}`);
    }
    if (scores.length >= 7) {
      const r7 = mean(scores.slice(0, 7));
      const o7 = mean(scores.slice(7, 14));
      if (r7 != null && o7 != null)
        lines.push(
          `  7-day avg: ${r7.toFixed(1)}% vs prior 7-day: ${o7.toFixed(1)}%`
        );
    }
  }

  const cycles = forUser(userId).all<CycleRow>(
    `SELECT date, strain, kilojoule, avg_hr, max_hr FROM cycles WHERE user_id = ? ORDER BY date DESC LIMIT ${limit}`,
  );

  if (cycles.length) {
    lines.push("\nDAILY STRAIN (newest first):");
    for (const c of cycles) {
      const strain = isFiniteNum(c.strain) ? c.strain.toFixed(1) : "n/a";
      const kcal = isFiniteNum(c.kilojoule) ? `${(c.kilojoule / 4.184).toFixed(0)}kcal` : "n/a";
      lines.push(`  ${c.date}: Strain=${strain}, Calories=${kcal}`);
    }
  }

  type FullSleepRow = SleepRow & { disturbances: number | null; respiratory_rate: number | null };
  const sleep = forUser(userId).all<FullSleepRow>(
    `SELECT date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms, performance, efficiency, disturbances, respiratory_rate FROM sleep WHERE COALESCE(nap, 0) = 0 AND user_id = ? ORDER BY date DESC LIMIT ${limit}`,
  );

  if (sleep.length) {
    lines.push("\nSLEEP (newest first):");
    for (const s of sleep) {
      const inBed = isFiniteNum(s.in_bed_ms) ? s.in_bed_ms : 0;
      const awake = isFiniteNum(s.awake_ms) ? s.awake_ms : 0;
      const actualHrs = (inBed - awake) / 3_600_000;
      const needHrs = (isFiniteNum(s.sleep_need_ms) ? s.sleep_need_ms : 0) / 3_600_000;
      const deepHrs = (isFiniteNum(s.deep_ms) ? s.deep_ms : 0) / 3_600_000;
      const remHrs = (isFiniteNum(s.rem_ms) ? s.rem_ms : 0) / 3_600_000;
      const slept = isFiniteNum(s.in_bed_ms) ? `${actualHrs.toFixed(1)}h` : "n/a";
      const need = isFiniteNum(s.sleep_need_ms) ? `${needHrs.toFixed(1)}h` : "n/a";
      const deep = isFiniteNum(s.deep_ms) ? `${deepHrs.toFixed(1)}h` : "n/a";
      const rem = isFiniteNum(s.rem_ms) ? `${remHrs.toFixed(1)}h` : "n/a";
      const dist = isFiniteNum(s.disturbances) ? `${s.disturbances}` : "n/a";
      const perf = isFiniteNum(s.performance) ? `, Perf=${s.performance.toFixed(0)}%` : "";
      const eff = isFiniteNum(s.efficiency) ? `, Eff=${s.efficiency.toFixed(0)}%` : "";
      const rr = isFiniteNum(s.respiratory_rate) ? `, RespRate=${s.respiratory_rate.toFixed(1)}bpm` : "";
      lines.push(
        `  ${s.date}: Slept=${slept} (need=${need}), Deep=${deep}, REM=${rem}, Disturbances=${dist}${perf}${eff}${rr}`
      );
    }
  }

  const workouts = forUser(userId).all<WorkoutRow>(
    `SELECT id, date, sport, duration_sec, avg_hr, max_hr, strain, kilojoule FROM workouts WHERE user_id = ? ORDER BY date DESC LIMIT ${limit}`,
  );

  if (workouts.length) {
    lines.push("\nWORKOUTS (newest first):");
    for (const w of workouts) {
      const dur = ((w.duration_sec ?? 0) / 60).toFixed(0);
      lines.push(`  ${w.date}: ${w.sport} — ${dur}min, Strain=${w.strain?.toFixed(1)}, AvgHR=${w.avg_hr}bpm`);
    }
  }

  return lines.join("\n");
}
