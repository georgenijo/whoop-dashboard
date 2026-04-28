import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import Database, { type Database as DB } from "better-sqlite3";

export type RecoveryRow = {
  date: string;
  recovery_score: number | null;
  hrv: number | null;
  rhr: number | null;
  spo2: number | null;
  skin_temp: number | null;
};

export type CycleRow = {
  date: string;
  strain: number | null;
  kilojoule: number | null;
  avg_hr: number | null;
  max_hr: number | null;
};

export type SleepRow = {
  date: string;
  in_bed_ms: number | null;
  light_ms: number | null;
  deep_ms: number | null;
  rem_ms: number | null;
  awake_ms: number | null;
  sleep_need_ms: number | null;
  performance: number | null;
  efficiency: number | null;
  disturbances: number | null;
  respiratory_rate: number | null;
};

export type WorkoutRow = {
  id: string;
  date: string;
  sport: string | null;
  duration_sec: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  strain: number | null;
  kilojoule: number | null;
};

function dbPath(): string {
  if (process.env.WHOOP_DB_PATH) return process.env.WHOOP_DB_PATH;
  // shared/whoop_data.db at repo root (matches streamlit/whoop/db.py).
  return path.resolve(process.cwd(), "..", "shared", "whoop_data.db");
}

/** Open the DB read-only. Returns null if the file doesn't exist yet. */
function open(): DB | null {
  const p = dbPath();
  if (!existsSync(p)) return null;
  try {
    return new Database(p, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

function hasTable(db: DB, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { name: string } | undefined;
  return !!row;
}

function safeQuery<T>(fn: (db: DB) => T): T | null {
  const db = open();
  if (!db) return null;
  try {
    return fn(db);
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function getLatestRecovery(): RecoveryRow | null {
  return safeQuery((db) => {
    if (!hasTable(db, "recovery")) return null;
    const row = db
      .prepare(
        "SELECT date, recovery_score, hrv, rhr, spo2, skin_temp FROM recovery ORDER BY date DESC LIMIT 1"
      )
      .get() as RecoveryRow | undefined;
    return row ?? null;
  });
}

export function getPreviousRecovery(): RecoveryRow | null {
  return safeQuery((db) => {
    if (!hasTable(db, "recovery")) return null;
    const row = db
      .prepare(
        "SELECT date, recovery_score, hrv, rhr, spo2, skin_temp FROM recovery ORDER BY date DESC LIMIT 1 OFFSET 1"
      )
      .get() as RecoveryRow | undefined;
    return row ?? null;
  });
}

export function getRecoveryTrend(days: number): RecoveryRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "recovery")) return [];
      const rows = db
        .prepare(
          "SELECT date, recovery_score, hrv, rhr, spo2, skin_temp FROM recovery ORDER BY date DESC LIMIT ?"
        )
        .all(days) as RecoveryRow[];
      return rows.reverse();
    }) ?? []
  );
}

export function getLatestCycle(): CycleRow | null {
  return safeQuery((db) => {
    if (!hasTable(db, "cycles")) return null;
    const row = db
      .prepare(
        "SELECT date, strain, kilojoule, avg_hr, max_hr FROM cycles ORDER BY date DESC LIMIT 1"
      )
      .get() as CycleRow | undefined;
    return row ?? null;
  });
}

export function getPreviousCycle(): CycleRow | null {
  return safeQuery((db) => {
    if (!hasTable(db, "cycles")) return null;
    const row = db
      .prepare(
        "SELECT date, strain, kilojoule, avg_hr, max_hr FROM cycles ORDER BY date DESC LIMIT 1 OFFSET 1"
      )
      .get() as CycleRow | undefined;
    return row ?? null;
  });
}

export function getStrainTrend(days: number): CycleRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "cycles")) return [];
      const rows = db
        .prepare(
          "SELECT date, strain, kilojoule, avg_hr, max_hr FROM cycles ORDER BY date DESC LIMIT ?"
        )
        .all(days) as CycleRow[];
      return rows.reverse();
    }) ?? []
  );
}

export function getLatestSleep(): SleepRow | null {
  return safeQuery((db) => {
    if (!hasTable(db, "sleep")) return null;
    const row = db
      .prepare(
        "SELECT date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms, performance, efficiency, disturbances, respiratory_rate FROM sleep WHERE nap = 0 ORDER BY date DESC LIMIT 1"
      )
      .get() as SleepRow | undefined;
    return row ?? null;
  });
}

export function getPreviousSleep(): SleepRow | null {
  return safeQuery((db) => {
    if (!hasTable(db, "sleep")) return null;
    const row = db
      .prepare(
        "SELECT date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms, performance, efficiency, disturbances, respiratory_rate FROM sleep WHERE nap = 0 ORDER BY date DESC LIMIT 1 OFFSET 1"
      )
      .get() as SleepRow | undefined;
    return row ?? null;
  });
}

export function getSleepTrend(days: number): SleepRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "sleep")) return [];
      const rows = db
        .prepare(
          "SELECT date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms, performance, efficiency, disturbances, respiratory_rate FROM sleep WHERE nap = 0 ORDER BY date DESC LIMIT ?"
        )
        .all(days) as SleepRow[];
      return rows.reverse();
    }) ?? []
  );
}

export function getLatestInsight(): { date: string; insight: string } | null {
  return safeQuery((db) => {
    if (!hasTable(db, "insights")) return null;
    const row = db
      .prepare("SELECT date, insight FROM insights ORDER BY date DESC LIMIT 1")
      .get() as { date: string; insight: string } | undefined;
    return row ?? null;
  });
}

export function getWorkouts(limit: number): WorkoutRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "workouts")) return [];
      return db
        .prepare(
          "SELECT id, date, sport, duration_sec, avg_hr, max_hr, strain, kilojoule FROM workouts ORDER BY date DESC LIMIT ?"
        )
        .all(limit) as WorkoutRow[];
    }) ?? []
  );
}

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

export function getOverview(days = 30): Overview {
  const recoveryTrend = getRecoveryTrend(days);
  const strainTrend = getStrainTrend(days);
  const sleepTrend = getSleepTrend(days);
  const latestRecovery = getLatestRecovery();
  return {
    latestRecovery,
    previousRecovery: getPreviousRecovery(),
    latestCycle: getLatestCycle(),
    previousCycle: getPreviousCycle(),
    latestSleep: getLatestSleep(),
    previousSleep: getPreviousSleep(),
    recoveryTrend,
    strainTrend,
    sleepTrend,
    hasData: !!latestRecovery,
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
    const scores = recovery.map((r) => r.recovery_score ?? 0).filter(Boolean);
    const hrvs = recovery.map((r) => r.hrv ?? 0).filter(Boolean);
    const rhrs = recovery.map((r) => r.rhr ?? 0).filter(Boolean);
    if (scores.length)
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
      "SELECT date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms, performance, efficiency, disturbances, respiratory_rate FROM sleep WHERE nap = 0 ORDER BY date DESC LIMIT ?"
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

export function getFullSleepTrend(days: number): SleepRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "sleep")) return [];
      return db
        .prepare(
          "SELECT date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms, performance, efficiency, disturbances, respiratory_rate FROM sleep WHERE nap = 0 ORDER BY date DESC LIMIT ?"
        )
        .all(days) as SleepRow[];
    }) ?? []
  ).reverse();
}
