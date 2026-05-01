import "server-only";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
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

export type JournalRow = {
  date: string;
  title: string | null;
  content: string | null;
  mood: string | null;
  tags: string | null;
};

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

export type SettingLock = {
  key: string;
  value: string;
};

export type User = {
  id: number;
  email: string | null;
  name: string | null;
};

export type Session = {
  id: number;
  user_id: number;
  token: string;
  expires_at: string;
};

export type ChatThread = {
  id: number;
  user_id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatThreadSummary = {
  id: number;
  title: string | null;
  updated_at: string;
  message_count: number;
  last_preview: string | null;
};

function dbPath(): string {
  if (process.env.WHOOP_DB_PATH) return process.env.WHOOP_DB_PATH;
  // shared/whoop_data.db at repo root (matches streamlit/whoop/db.py).
  return path.resolve(process.cwd(), "..", "..", "shared", "whoop_data.db");
}

function openWrite(): DB | null {
  const p = dbPath();
  if (!existsSync(p)) return null;
  try {
    const db = new Database(p, { fileMustExist: true });
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS daily_summary (
        date TEXT PRIMARY KEY,
        recovery_score INTEGER,
        hrv_ms REAL,
        resting_hr INTEGER,
        sleep_hours REAL,
        sleep_efficiency REAL,
        sleep_performance INTEGER,
        day_strain REAL,
        max_hr INTEGER,
        avg_hr INTEGER,
        kilojoules REAL,
        workouts_count INTEGER,
        computed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_daily_summary_date ON daily_summary(date DESC);
      CREATE TABLE IF NOT EXISTS chat_threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        title TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_chat_threads_user ON chat_threads(user_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER REFERENCES chat_threads(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        blocks TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_id ON chat_messages(id);
      CREATE TABLE IF NOT EXISTS chat_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        prompt_preview TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        response_length INTEGER NOT NULL,
        error_message TEXT,
        days_context INTEGER,
        type TEXT,
        details TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_chat_logs_started ON chat_logs(started_at DESC);
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS insights (
        date TEXT PRIMARY KEY,
        insight TEXT,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS sync_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        recovery_count INTEGER,
        sleep_count INTEGER,
        workouts_count INTEGER,
        error_message TEXT,
        source TEXT,
        details TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sync_logs_started ON sync_logs(started_at DESC);
      CREATE TABLE IF NOT EXISTS route_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        route TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        status INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS route_logs_started_at_idx ON route_logs(started_at DESC);
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        apple_sub TEXT UNIQUE,
        email TEXT,
        name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        token TEXT UNIQUE NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    `);
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (1)").run();
    const cols = db.prepare("PRAGMA table_info(chat_logs)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "type")) {
      db.exec("ALTER TABLE chat_logs ADD COLUMN type TEXT");
    }
    if (!cols.some((c) => c.name === "details")) {
      db.exec("ALTER TABLE chat_logs ADD COLUMN details TEXT");
    }
    const syncCols = db.prepare("PRAGMA table_info(sync_logs)").all() as { name: string }[];
    if (!syncCols.some((c) => c.name === "details")) {
      db.exec("ALTER TABLE sync_logs ADD COLUMN details TEXT");
    }
    const insightCols = db.prepare("PRAGMA table_info(insights)").all() as { name: string }[];
    if (!insightCols.some((c) => c.name === "created_at")) {
      db.exec("ALTER TABLE insights ADD COLUMN created_at TEXT");
    }
    const chatCols = db.prepare("PRAGMA table_info(chat_messages)").all() as {
      name: string;
    }[];
    if (!chatCols.some((c) => c.name === "blocks")) {
      db.exec("ALTER TABLE chat_messages ADD COLUMN blocks TEXT");
    }
    if (!chatCols.some((c) => c.name === "thread_id")) {
      db.exec("ALTER TABLE chat_messages ADD COLUMN thread_id INTEGER REFERENCES chat_threads(id)");
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, id)");
    const orphan = db
      .prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE thread_id IS NULL")
      .get() as { n: number } | undefined;
    if (orphan && orphan.n > 0) {
      db.exec(`
        INSERT OR IGNORE INTO chat_threads (id, user_id, title)
        VALUES (1, 1, 'Legacy chat');
        UPDATE chat_messages SET thread_id = 1 WHERE thread_id IS NULL;
      `);
    }
    return db;
  } catch {
    return null;
  }
}

let routeLogsSchemaReady = false;

function openRouteLogWrite(): DB | null {
  const p = dbPath();
  if (!existsSync(p)) return null;
  try {
    const db = new Database(p, { fileMustExist: true });
    try {
      db.pragma("journal_mode = WAL");
      if (!routeLogsSchemaReady) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS route_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT NOT NULL,
            route TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            status INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS route_logs_started_at_idx ON route_logs(started_at DESC);
        `);
        routeLogsSchemaReady = true;
      }
      return db;
    } catch {
      db.close();
      return null;
    }
  } catch {
    return null;
  }
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

function hasColumn(db: DB, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((row) => row.name === column);
}

function dateRangeClause(startDate: string, endDate: string): {
  clause: string;
  params: [string, string];
} {
  return {
    clause: "date >= ? AND date <= ?",
    params: [startDate, endDate],
  };
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

function safeWriteQuery<T>(fn: (db: DB) => T): T | null {
  const db = openWrite();
  if (!db) return null;
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function getUserById(id: number): User | null {
  return safeWriteQuery((db) => {
    const row = db
      .prepare("SELECT id, email, name FROM users WHERE id = ? LIMIT 1")
      .get(id) as User | undefined;
    return row ?? null;
  });
}

export function getSessionByToken(token: string): Session | null {
  return safeWriteQuery((db) => {
    const row = db
      .prepare("SELECT id, user_id, token, expires_at FROM sessions WHERE token = ? LIMIT 1")
      .get(token) as Session | undefined;
    return row ?? null;
  });
}

export function createSession(userId: number): { token: string; expiresAt: string } {
  const db = openWrite();
  if (!db) throw new Error("Database unavailable");
  try {
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare("INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)").run(
      userId,
      token,
      expiresAt
    );
    return { token, expiresAt };
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

export function getRecoveryRange(startDate: string, endDate: string): RecoveryRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "recovery")) return [];
      const range = dateRangeClause(startDate, endDate);
      return db
        .prepare(
          `SELECT date, recovery_score, hrv, rhr, spo2, skin_temp FROM recovery WHERE ${range.clause} ORDER BY date ASC`
        )
        .all(...range.params) as RecoveryRow[];
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

export function getStrainRange(startDate: string, endDate: string): CycleRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "cycles")) return [];
      const range = dateRangeClause(startDate, endDate);
      return db
        .prepare(
          `SELECT date, strain, kilojoule, avg_hr, max_hr FROM cycles WHERE ${range.clause} ORDER BY date ASC`
        )
        .all(...range.params) as CycleRow[];
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

export function getSleepRange(startDate: string, endDate: string): SleepRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "sleep")) return [];
      const range = dateRangeClause(startDate, endDate);
      return db
        .prepare(
          `SELECT date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms, performance, efficiency, disturbances, respiratory_rate FROM sleep WHERE nap = 0 AND ${range.clause} ORDER BY date ASC`
        )
        .all(...range.params) as SleepRow[];
    }) ?? []
  );
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

export function getWorkoutsRange(startDate: string, endDate: string): WorkoutRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "workouts")) return [];
      const range = dateRangeClause(startDate, endDate);
      return db
        .prepare(
          `SELECT id, date, sport, duration_sec, avg_hr, max_hr, strain, kilojoule FROM workouts WHERE ${range.clause} ORDER BY date ASC`
        )
        .all(...range.params) as WorkoutRow[];
    }) ?? []
  );
}

export function getJournalRange(startDate: string, endDate: string): JournalRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "journal")) return [];
      const hasTitle = hasColumn(db, "journal", "title");
      const hasContent = hasColumn(db, "journal", "content");
      const hasMood = hasColumn(db, "journal", "mood");
      const hasTags = hasColumn(db, "journal", "tags");
      const title = hasTitle ? "title" : "NULL AS title";
      const content = hasContent ? "content" : "NULL AS content";
      const mood = hasMood ? "mood" : "NULL AS mood";
      const tags = hasTags ? "tags" : "NULL AS tags";
      const range = dateRangeClause(startDate, endDate);
      return db
        .prepare(
          `SELECT date, ${title}, ${content}, ${mood}, ${tags} FROM journal WHERE ${range.clause} ORDER BY date ASC`
        )
        .all(...range.params) as JournalRow[];
    }) ?? []
  );
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

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type ChatMessageInsert = {
  role: "user" | "assistant";
  content: string;
  blocks?: unknown;
};

function visibleChatMessageClause(alias: string): string {
  return `${alias}.content != '[tool_result]' AND NOT (${alias}.role = 'assistant' AND ${alias}.blocks LIKE '%"type":"tool_use"%')`;
}

function hasChatThread(db: DB, threadId: number, userId?: number): boolean {
  const row =
    userId == null
      ? db.prepare("SELECT id FROM chat_threads WHERE id = ? LIMIT 1").get(threadId)
      : db
          .prepare("SELECT id FROM chat_threads WHERE id = ? AND user_id = ? LIMIT 1")
          .get(threadId, userId);
  return !!row;
}

export function getPrimaryUser(): User | null {
  return getUserById(1);
}

export function getChatThreads(userId: number): ChatThreadSummary[] {
  return (
    safeWriteQuery((db) => {
      if (!hasTable(db, "chat_threads")) return [] as ChatThreadSummary[];
      const visibleM = visibleChatMessageClause("m");
      const visibleM2 = visibleChatMessageClause("m2");
      return db
        .prepare(`
          SELECT
            t.id,
            t.title,
            t.updated_at,
            COUNT(m.id) AS message_count,
            (
              SELECT m2.content
              FROM chat_messages m2
              WHERE m2.thread_id = t.id AND ${visibleM2}
              ORDER BY m2.id DESC
              LIMIT 1
            ) AS last_preview
          FROM chat_threads t
          LEFT JOIN chat_messages m
            ON m.thread_id = t.id AND ${visibleM}
          WHERE t.user_id = ?
          GROUP BY t.id
          ORDER BY t.updated_at DESC, t.id DESC
        `)
        .all(userId) as ChatThreadSummary[];
    }) ?? []
  );
}

export function getLatestChatThread(userId: number): ChatThread | null {
  return (
    safeWriteQuery((db) => {
      if (!hasTable(db, "chat_threads")) return null;
      const row = db
        .prepare(
          "SELECT id, user_id, title, created_at, updated_at FROM chat_threads WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1"
        )
        .get(userId) as ChatThread | undefined;
      return row ?? null;
    }) ?? null
  );
}

export function getChatThreadById(userId: number, threadId: number): ChatThread | null {
  return (
    safeWriteQuery((db) => {
      if (!hasTable(db, "chat_threads")) return null;
      const row = db
        .prepare(
          "SELECT id, user_id, title, created_at, updated_at FROM chat_threads WHERE id = ? AND user_id = ? LIMIT 1"
        )
        .get(threadId, userId) as ChatThread | undefined;
      return row ?? null;
    }) ?? null
  );
}

export function createChatThread(userId: number, title: string | null = null): ChatThread | null {
  return (
    safeWriteQuery((db) => {
      if (!hasTable(db, "chat_threads")) return null;
      const result = db
        .prepare("INSERT INTO chat_threads (user_id, title) VALUES (?, ?)")
        .run(userId, title);
      const thread = db
        .prepare(
          "SELECT id, user_id, title, created_at, updated_at FROM chat_threads WHERE id = ? LIMIT 1"
        )
        .get(Number(result.lastInsertRowid)) as ChatThread | undefined;
      return thread ?? null;
    }) ?? null
  );
}

export function touchChatThread(threadId: number): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare("UPDATE chat_threads SET updated_at = datetime('now') WHERE id = ?").run(threadId);
  } finally {
    db.close();
  }
}

export function setChatThreadTitle(threadId: number, title: string | null): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      "UPDATE chat_threads SET title = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(title, threadId);
  } finally {
    db.close();
  }
}

export function deleteChatThread(threadId: number, userId: number): boolean {
  const db = openWrite();
  if (!db) return false;
  try {
    const getThread = db.prepare(
      "SELECT id FROM chat_threads WHERE id = ? AND user_id = ? LIMIT 1"
    );
    const deleteMessages = db.prepare("DELETE FROM chat_messages WHERE thread_id = ?");
    const deleteThread = db.prepare("DELETE FROM chat_threads WHERE id = ? AND user_id = ?");
    const removeThread = db.transaction(() => {
      const thread = getThread.get(threadId, userId) as { id: number } | undefined;
      if (!thread) return false;
      deleteMessages.run(threadId);
      deleteThread.run(threadId, userId);
      return true;
    });
    return removeThread() as boolean;
  } finally {
    db.close();
  }
}

export function resolveChatThread(
  userId: number,
  threadId: number | null | undefined,
  createIfMissing = false
): ChatThread | null {
  if (threadId != null) {
    return getChatThreadById(userId, threadId);
  }
  const latest = getLatestChatThread(userId);
  if (latest) return latest;
  if (!createIfMissing) return null;
  return createChatThread(userId, null);
}

export function getOrCreateChatThread(userId: number): ChatThread | null {
  return resolveChatThread(userId, null, true);
}

export function getChatThreadSummary(userId: number, threadId: number): ChatThreadSummary | null {
  return (
    safeWriteQuery((db) => {
      if (!hasTable(db, "chat_threads")) return null;
      const visibleM = visibleChatMessageClause("m");
      const visibleM2 = visibleChatMessageClause("m2");
      const row = db
        .prepare(
          `
          SELECT
            t.id,
            t.title,
            t.updated_at,
            COUNT(m.id) AS message_count,
            (
              SELECT m2.content
              FROM chat_messages m2
              WHERE m2.thread_id = t.id AND ${visibleM2}
              ORDER BY m2.id DESC
              LIMIT 1
            ) AS last_preview
          FROM chat_threads t
          LEFT JOIN chat_messages m
            ON m.thread_id = t.id AND ${visibleM}
          WHERE t.id = ? AND t.user_id = ?
          GROUP BY t.id
          LIMIT 1
        `
        )
        .get(threadId, userId) as ChatThreadSummary | undefined;
      return row ?? null;
    }) ?? null
  );
}

export function getChatThreadMessages(userId: number, threadId: number): ChatMessage[] {
  return (
    safeWriteQuery((db) => {
      if (!hasTable(db, "chat_messages") || !hasTable(db, "chat_threads")) {
        return [] as ChatMessage[];
      }
      if (!hasChatThread(db, threadId, userId)) return [] as ChatMessage[];
      const visibleMessage = visibleChatMessageClause("chat_messages");
      return db
        .prepare(
          `SELECT id, role, content, created_at FROM chat_messages WHERE thread_id = ? AND ${visibleMessage} ORDER BY id ASC`
        )
        .all(threadId) as ChatMessage[];
    }) ?? []
  );
}

export function getChatThreadConversation(
  userId: number,
  threadId: number
): {
  role: "user" | "assistant";
  content: unknown;
}[] {
  return (
    safeWriteQuery((db) => {
      if (!hasTable(db, "chat_messages") || !hasTable(db, "chat_threads")) {
        return [] as { role: "user" | "assistant"; content: unknown }[];
      }
      if (!hasChatThread(db, threadId, userId)) {
        return [] as { role: "user" | "assistant"; content: unknown }[];
      }
      const rows = db
        .prepare("SELECT role, content, blocks FROM chat_messages WHERE thread_id = ? ORDER BY id ASC")
        .all(threadId) as {
          role: "user" | "assistant";
          content: string;
          blocks: string | null;
        }[];
      return rows.map((row) => {
        if (row.blocks !== null) {
          try {
            return {
              role: row.role,
              content: JSON.parse(row.blocks),
            };
          } catch {
            return {
              role: row.role,
              content: row.content,
            };
          }
        }
        return {
          role: row.role,
          content: row.content,
        };
      });
    }) ?? []
  );
}

export function getChatMessages(threadId = 1): ChatMessage[] {
  return getChatThreadMessages(1, threadId);
}

export function getChatConversation(threadId = 1): {
  role: "user" | "assistant";
  content: unknown;
}[] {
  return getChatThreadConversation(1, threadId);
}

export function getLegacyChatThreadId(): number {
  return 1;
}

export function getLegacyChatMessages(): ChatMessage[] {
  return getChatMessages(1);
}

export function getLegacyChatConversation(): {
  role: "user" | "assistant";
  content: unknown;
}[] {
  return getChatConversation(1);
}

export function addChatMessage(
  threadId: number,
  role: "user" | "assistant",
  content: string,
  blocks?: unknown
): void {
  addChatMessages(threadId, [{ role, content, blocks }]);
}

export function addChatMessages(threadId: number, messages: ChatMessageInsert[]): void {
  if (messages.length === 0) return;

  const db = openWrite();
  if (!db) return;
  try {
    const insert = db.prepare(
      "INSERT INTO chat_messages (thread_id, role, content, blocks, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    const touch = db.prepare("UPDATE chat_threads SET updated_at = datetime('now') WHERE id = ?");
    const writeTurn = db.transaction((rows: ChatMessageInsert[]) => {
      for (const message of rows) {
        insert.run(
          threadId,
          message.role,
          message.content,
          message.blocks === undefined ? null : JSON.stringify(message.blocks),
          new Date().toISOString()
        );
      }
      touch.run(threadId);
    });
    writeTurn(messages);
  } finally {
    db.close();
  }
}

export function clearChatMessages(threadId = 1): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare("DELETE FROM chat_messages WHERE thread_id = ?").run(threadId);
    db.prepare("UPDATE chat_threads SET updated_at = datetime('now') WHERE id = ?").run(threadId);
  } finally {
    db.close();
  }
}
export type ChatLog = {
  id: number;
  started_at: string;
  prompt_preview: string;
  duration_ms: number;
  status: "ok" | "error" | "aborted";
  response_length: number;
  error_message: string | null;
  days_context: number | null;
  type: "cli" | "api" | null;
  details?: string | null;
};

export function addChatLog(log: Omit<ChatLog, "id">): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      "INSERT INTO chat_logs (started_at, prompt_preview, duration_ms, status, response_length, error_message, days_context, type, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      log.started_at,
      log.prompt_preview,
      log.duration_ms,
      log.status,
      log.response_length,
      log.error_message,
      log.days_context,
      log.type,
      log.details ?? null
    );
  } finally {
    db.close();
  }
}

export function getChatLogs(limit = 200): ChatLog[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "chat_logs")) return [] as ChatLog[];
      return db
        .prepare(
          "SELECT id, started_at, prompt_preview, duration_ms, status, response_length, error_message, days_context, type, details FROM chat_logs ORDER BY id DESC LIMIT ?"
        )
        .all(limit) as ChatLog[];
    }) ?? []
  );
}

export function clearChatLogs(): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare("DELETE FROM chat_logs").run();
  } finally {
    db.close();
  }
}

export type SyncLog = {
  id: number;
  started_at: string;
  duration_ms: number;
  status: "ok" | "error";
  recovery_count: number | null;
  sleep_count: number | null;
  workouts_count: number | null;
  error_message: string | null;
  source: string | null;
  details?: string | null;
};

export function addSyncLog(log: Omit<SyncLog, "id">): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      "INSERT INTO sync_logs (started_at, duration_ms, status, recovery_count, sleep_count, workouts_count, error_message, source, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      log.started_at,
      log.duration_ms,
      log.status,
      log.recovery_count,
      log.sleep_count,
      log.workouts_count,
      log.error_message,
      log.source,
      log.details ?? null
    );
  } finally {
    db.close();
  }
}

export function getSyncLogs(limit = 200): SyncLog[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "sync_logs")) return [] as SyncLog[];
      const detailsSelect = hasColumn(db, "sync_logs", "details")
        ? "details"
        : "NULL AS details";
      return db
        .prepare(
          `SELECT id, started_at, duration_ms, status, recovery_count, sleep_count, workouts_count, error_message, source, ${detailsSelect} FROM sync_logs ORDER BY id DESC LIMIT ?`
        )
        .all(limit) as SyncLog[];
    }) ?? []
  );
}

export type RouteLog = {
  id: number;
  started_at: string;
  route: string;
  duration_ms: number;
  status: number;
};

export function addRouteLog(log: Omit<RouteLog, "id">): void {
  const db = openRouteLogWrite();
  if (!db) return;
  try {
    db.prepare(
      "INSERT INTO route_logs (started_at, route, duration_ms, status) VALUES (?, ?, ?, ?)"
    ).run(log.started_at, log.route, log.duration_ms, log.status);
  } finally {
    db.close();
  }
}

export function getRouteLogs(limit = 200): RouteLog[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "route_logs")) return [] as RouteLog[];
      return db
        .prepare(
          "SELECT id, started_at, route, duration_ms, status FROM route_logs ORDER BY started_at DESC, id DESC LIMIT ?"
        )
        .all(limit) as RouteLog[];
    }) ?? []
  );
}

export function getSetting(key: string): string | null {
  return safeQuery((db) => {
    if (!hasTable(db, "app_settings")) return null;
    const row = db
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  });
}

function settingLockExpiresMs(value: string | null): number | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { expires_at?: unknown };
    if (typeof parsed.expires_at !== "string") return null;
    const ms = Date.parse(parsed.expires_at);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

export function isSettingLockActive(key: string): boolean {
  const value = getSetting(key);
  const expiresMs = settingLockExpiresMs(value);
  return expiresMs !== null && expiresMs > Date.now();
}

export function acquireSettingLock(key: string, ttlMs: number): SettingLock | null {
  const db = openWrite();
  if (!db) return null;
  try {
    const nowMs = Date.now();
    const value = JSON.stringify({
      token: randomUUID(),
      acquired_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + ttlMs).toISOString(),
    });
    const select = db.prepare("SELECT value FROM app_settings WHERE key = ?");
    const upsert = db.prepare(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
    const acquire = db.transaction(() => {
      const row = select.get(key) as { value: string | null } | undefined;
      const expiresMs = settingLockExpiresMs(row?.value ?? null);
      if (expiresMs !== null && expiresMs > nowMs) return false;
      upsert.run(key, value);
      return true;
    });
    return (acquire.immediate() as boolean) ? { key, value } : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function releaseSettingLock(lock: SettingLock): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare("DELETE FROM app_settings WHERE key = ? AND value = ?").run(
      lock.key,
      lock.value
    );
  } finally {
    db.close();
  }
}

export function setSetting(key: string, value: string): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(key, value);
  } finally {
    db.close();
  }
}
