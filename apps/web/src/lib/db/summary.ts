import "server-only";
import {
  type DB,
  hasColumn,
  hasTable,
  openWrite,
  safeQuery,
} from "./connection";
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
  table: "recovery" | "cycles" | "sleep",
  where = ""
): number | null {
  if (!hasTable(db, table)) return null;
  const rawSelect = hasColumn(db, table, "raw") ? "raw" : "NULL AS raw";
  const row = db
    .prepare(`SELECT date, ${rawSelect} FROM ${table} ${where} ORDER BY date DESC LIMIT 1`)
    .get() as { date: string | null; raw: string | null } | undefined;
  return row ? rawTimestampMs(row) : null;
}

export function getLatestWhoopDataTimestamp(): string | null {
  return safeQuery((db) => {
    const sleepWhere = hasTable(db, "sleep") && hasColumn(db, "sleep", "nap")
      ? "WHERE COALESCE(nap, 0) = 0"
      : "";
    const timestamps = [
      latestTableTimestampMs(db, "recovery"),
      latestTableTimestampMs(db, "cycles"),
      latestTableTimestampMs(db, "sleep", sleepWhere),
    ].filter((ms): ms is number => ms !== null);
    if (timestamps.length === 0) return null;
    return new Date(Math.max(...timestamps)).toISOString();
  });
}

export function getLatestInsight(): InsightRow | null {
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

export function getDailySummary(start: string, end: string): DailySummaryRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "daily_summary")) return [];
      return db
        .prepare(
          "SELECT date, recovery_score, hrv_ms, resting_hr, sleep_hours, sleep_efficiency, sleep_performance, day_strain, max_hr, avg_hr, kilojoules, workouts_count, computed_at FROM daily_summary WHERE date BETWEEN ? AND ? ORDER BY date ASC"
        )
        .all(start, end) as DailySummaryRow[];
    }) ?? []
  );
}

export function getOverview(days = 30): Overview {
  const recoveryTrend = getRecoveryTrend(days);
  const strainTrend = getStrainTrend(days);
  const sleepTrend = getSleepTrend(days);
  const latestRecovery = getLatestRecovery();
  const latestCycle = getLatestCycle();
  const latestSleep = getLatestSleep();
  return {
    latestRecovery,
    previousRecovery: getPreviousRecovery(),
    latestCycle,
    previousCycle: getPreviousCycle(),
    latestSleep,
    previousSleep: getPreviousSleep(),
    recoveryTrend,
    strainTrend,
    sleepTrend,
    hasData: Boolean(latestRecovery || latestCycle || latestSleep),
  };
}

export function getHealthContext(days = 30): string {
  const lines: string[] = [`=== WHOOP DATA (last ${days} days) ===\n`];

  const recovery = safeQuery((db) => {
    if (!hasTable(db, "recovery")) return [] as RecoveryRow[];
    return db.prepare(
      "SELECT date, recovery_score, hrv, rhr, spo2, skin_temp FROM recovery ORDER BY date DESC LIMIT ?"
    ).all(days) as RecoveryRow[];
  }) ?? [];

  if (recovery.length) {
    lines.push("RECOVERY (newest first):");
    for (const r of recovery) {
      const spo2 = r.spo2 != null ? `, SpO2=${r.spo2}%` : "";
      const temp = r.skin_temp != null ? `, Skin=${r.skin_temp}°C` : "";
      lines.push(
        `  ${r.date}: Recovery=${r.recovery_score?.toFixed(0)}%, HRV=${r.hrv?.toFixed(1)}ms, RHR=${r.rhr?.toFixed(0)}bpm${spo2}${temp}`
      );
    }
    const scores = recovery
      .map((r) => r.recovery_score)
      .filter((v): v is number => v != null);
    const hrvs = recovery
      .map((r) => r.hrv)
      .filter((v): v is number => v != null);
    const rhrs = recovery
      .map((r) => r.rhr)
      .filter((v): v is number => v != null);
    if (scores.length && hrvs.length && rhrs.length)
      lines.push(
        `\n  Averages: Recovery=${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)}%, HRV=${(hrvs.reduce((a, b) => a + b, 0) / hrvs.length).toFixed(1)}ms, RHR=${(rhrs.reduce((a, b) => a + b, 0) / rhrs.length).toFixed(1)}bpm`
      );
    if (scores.length >= 7) {
      const r7 = scores.slice(0, 7);
      const o7 = scores.slice(7, 14);
      if (o7.length)
        lines.push(
          `  7-day avg: ${(r7.reduce((a, b) => a + b, 0) / r7.length).toFixed(1)}% vs prior 7-day: ${(o7.reduce((a, b) => a + b, 0) / o7.length).toFixed(1)}%`
        );
    }
  }

  const cycles = safeQuery((db) => {
    if (!hasTable(db, "cycles")) return [] as CycleRow[];
    return db.prepare(
      "SELECT date, strain, kilojoule, avg_hr, max_hr FROM cycles ORDER BY date DESC LIMIT ?"
    ).all(days) as CycleRow[];
  }) ?? [];

  if (cycles.length) {
    lines.push("\nDAILY STRAIN (newest first):");
    for (const c of cycles)
      lines.push(`  ${c.date}: Strain=${c.strain?.toFixed(1)}, Calories=${((c.kilojoule ?? 0) / 4.184).toFixed(0)}kcal`);
  }

  type FullSleepRow = SleepRow & { disturbances: number | null; respiratory_rate: number | null };
  const sleep = safeQuery((db) => {
    if (!hasTable(db, "sleep")) return [] as FullSleepRow[];
    return db.prepare(
      "SELECT date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms, performance, efficiency, disturbances, respiratory_rate FROM sleep WHERE COALESCE(nap, 0) = 0 ORDER BY date DESC LIMIT ?"
    ).all(days) as FullSleepRow[];
  }) ?? [];

  if (sleep.length) {
    lines.push("\nSLEEP (newest first):");
    for (const s of sleep) {
      const actualHrs = ((s.in_bed_ms ?? 0) - (s.awake_ms ?? 0)) / 3_600_000;
      const needHrs = (s.sleep_need_ms ?? 0) / 3_600_000;
      const deepHrs = (s.deep_ms ?? 0) / 3_600_000;
      const remHrs = (s.rem_ms ?? 0) / 3_600_000;
      const perf = s.performance != null ? `, Perf=${s.performance.toFixed(0)}%` : "";
      const eff = s.efficiency != null ? `, Eff=${s.efficiency.toFixed(0)}%` : "";
      const rr = s.respiratory_rate != null ? `, RespRate=${s.respiratory_rate.toFixed(1)}bpm` : "";
      lines.push(
        `  ${s.date}: Slept=${actualHrs.toFixed(1)}h (need=${needHrs.toFixed(1)}h), Deep=${deepHrs.toFixed(1)}h, REM=${remHrs.toFixed(1)}h, Disturbances=${s.disturbances ?? 0}${perf}${eff}${rr}`
      );
    }
  }

  const workouts = safeQuery((db) => {
    if (!hasTable(db, "workouts")) return [] as WorkoutRow[];
    return db.prepare(
      "SELECT id, date, sport, duration_sec, avg_hr, max_hr, strain, kilojoule FROM workouts ORDER BY date DESC LIMIT ?"
    ).all(days) as WorkoutRow[];
  }) ?? [];

  if (workouts.length) {
    lines.push("\nWORKOUTS (newest first):");
    for (const w of workouts) {
      const dur = ((w.duration_sec ?? 0) / 60).toFixed(0);
      lines.push(`  ${w.date}: ${w.sport} — ${dur}min, Strain=${w.strain?.toFixed(1)}, AvgHR=${w.avg_hr}bpm`);
    }
  }

  return lines.join("\n");
}
