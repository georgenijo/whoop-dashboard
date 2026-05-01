import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import Database, { type Database as DB } from "better-sqlite3";

export type { DB };

export function dbPath(): string {
  if (process.env.WHOOP_DB_PATH) return process.env.WHOOP_DB_PATH;
  // shared/whoop_data.db at repo root (matches streamlit/whoop/db.py).
  return path.resolve(process.cwd(), "..", "..", "shared", "whoop_data.db");
}

export function openWrite(): DB | null {
  const p = dbPath();
  if (!existsSync(p)) return null;
  try {
    const db = new Database(p, { fileMustExist: true });
    db.pragma("foreign_keys = ON");
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

/** Open the DB read-only. Returns null if the file doesn't exist yet. */
export function open(): DB | null {
  const p = dbPath();
  if (!existsSync(p)) return null;
  try {
    return new Database(p, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

export function hasTable(db: DB, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { name: string } | undefined;
  return !!row;
}

export function hasColumn(db: DB, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((row) => row.name === column);
}

export function dateRangeClause(startDate: string, endDate: string): {
  clause: string;
  params: [string, string];
} {
  return {
    clause: "date >= ? AND date <= ?",
    params: [startDate, endDate],
  };
}

export function safeQuery<T>(fn: (db: DB) => T): T | null {
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

export function safeWriteQuery<T>(fn: (db: DB) => T): T | null {
  const db = openWrite();
  if (!db) return null;
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
