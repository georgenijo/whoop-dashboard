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
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      CREATE TABLE IF NOT EXISTS sync_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        recovery_count INTEGER,
        sleep_count INTEGER,
        workouts_count INTEGER,
        error_message TEXT,
        source TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sync_logs_started ON sync_logs(started_at DESC);
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
    const chatCols = db.prepare("PRAGMA table_info(chat_messages)").all() as {
      name: string;
    }[];
    if (!chatCols.some((c) => c.name === "blocks")) {
      db.exec("ALTER TABLE chat_messages ADD COLUMN blocks TEXT");
    }
    return db;
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

export function getChatMessages(): ChatMessage[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "chat_messages")) return [] as ChatMessage[];
      return db
        .prepare(
          "SELECT id, role, content, created_at FROM chat_messages WHERE content != '[tool_result]' ORDER BY id ASC"
        )
        .all() as ChatMessage[];
    }) ?? []
  );
}

export function getChatConversation(): {
  role: "user" | "assistant";
  content: unknown;
}[] {
  return (
    safeWriteQuery((db) => {
      if (!hasTable(db, "chat_messages")) {
        return [] as { role: "user" | "assistant"; content: unknown }[];
      }
      const rows = db
        .prepare("SELECT role, content, blocks FROM chat_messages ORDER BY id ASC")
        .all() as {
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

export function addChatMessage(
  role: "user" | "assistant",
  content: string,
  blocks?: unknown
): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      "INSERT INTO chat_messages (role, content, blocks, created_at) VALUES (?, ?, ?, ?)"
    ).run(
      role,
      content,
      blocks === undefined ? null : JSON.stringify(blocks),
      new Date().toISOString()
    );
  } finally {
    db.close();
  }
}

export function clearChatMessages(): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare("DELETE FROM chat_messages").run();
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
};

export function addSyncLog(log: Omit<SyncLog, "id">): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      "INSERT INTO sync_logs (started_at, duration_ms, status, recovery_count, sleep_count, workouts_count, error_message, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      log.started_at,
      log.duration_ms,
      log.status,
      log.recovery_count,
      log.sleep_count,
      log.workouts_count,
      log.error_message,
      log.source
    );
  } finally {
    db.close();
  }
}

export function getSyncLogs(limit = 200): SyncLog[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "sync_logs")) return [] as SyncLog[];
      return db
        .prepare(
          "SELECT id, started_at, duration_ms, status, recovery_count, sleep_count, workouts_count, error_message, source FROM sync_logs ORDER BY id DESC LIMIT ?"
        )
        .all(limit) as SyncLog[];
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
