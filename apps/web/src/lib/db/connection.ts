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
  let db: DB | null = null;
  try {
    db = new Database(p, { fileMustExist: true });
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
    db.exec(`
      -- KEEP IN SYNC WITH streamlit/whoop/db.py:22-101 (Python init_db schema)
      CREATE TABLE IF NOT EXISTS recovery (
        date TEXT PRIMARY KEY,
        recovery_score REAL,
        hrv REAL,
        rhr REAL,
        spo2 REAL,
        skin_temp REAL,
        raw JSON
      );
      CREATE TABLE IF NOT EXISTS cycles (
        date TEXT PRIMARY KEY,
        strain REAL,
        kilojoule REAL,
        avg_hr INTEGER,
        max_hr INTEGER,
        raw JSON
      );
      CREATE TABLE IF NOT EXISTS sleep (
        date TEXT PRIMARY KEY,
        in_bed_ms INTEGER,
        light_ms INTEGER,
        deep_ms INTEGER,
        rem_ms INTEGER,
        awake_ms INTEGER,
        sleep_need_ms INTEGER,
        performance REAL,
        efficiency REAL,
        consistency REAL,
        respiratory_rate REAL,
        disturbances INTEGER,
        cycles INTEGER,
        nap BOOLEAN,
        need_from_baseline_ms INTEGER,
        need_from_debt_ms INTEGER,
        need_from_strain_ms INTEGER,
        need_from_nap_ms INTEGER,
        raw JSON
      );
      CREATE TABLE IF NOT EXISTS workouts (
        id TEXT PRIMARY KEY,
        date TEXT,
        sport TEXT,
        duration_sec REAL,
        avg_hr INTEGER,
        max_hr INTEGER,
        strain REAL,
        kilojoule REAL,
        distance_m REAL,
        zone_0_ms INTEGER,
        zone_1_ms INTEGER,
        zone_2_ms INTEGER,
        zone_3_ms INTEGER,
        zone_4_ms INTEGER,
        zone_5_ms INTEGER,
        raw JSON
      );
      CREATE TABLE IF NOT EXISTS body_measurements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) DEFAULT 1,
        height_meter REAL,
        weight_kilogram REAL,
        max_heart_rate INTEGER,
        measured_at TEXT NOT NULL,
        raw JSON
      );
      CREATE INDEX IF NOT EXISTS idx_body_measurements_user_measured
        ON body_measurements(user_id, measured_at DESC);
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
        source TEXT,
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
        details TEXT,
        partial INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_sync_logs_started ON sync_logs(started_at DESC);
      CREATE TABLE IF NOT EXISTS route_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        route TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        status INTEGER NOT NULL,
        details TEXT
      );
      CREATE INDEX IF NOT EXISTS route_logs_started_at_idx ON route_logs(started_at DESC);
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        apple_sub TEXT UNIQUE,
        email TEXT,
        name TEXT,
        timezone TEXT,
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
      -- KEEP IN SYNC WITH streamlit/whoop/integrations.py (Python helpers).
      -- access_token and refresh_token are encrypted with VAULT_KEY via NaCl
      -- secretbox; key_version pairs the row with the key used to encrypt.
      -- Column name is "scopes" (plural); public-API callers see "scope"
      -- (singular) to match Whoop OAuth + tokens.json shape.
      CREATE TABLE IF NOT EXISTS integrations (
        user_id INTEGER NOT NULL REFERENCES users(id),
        provider TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        scopes TEXT,
        token_type TEXT,
        raw TEXT,
        key_version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, provider)
      );
      -- Dead-letter queue for Whoop webhook deliveries. Every signature-valid
      -- event lands here pending; handler outcome moves it to succeeded /
      -- failed / discarded. Failed rows can be replayed via
      -- /api/admin/webhook/replay so a transient handler bug isn't a silent
      -- data loss past Whoop's 5x retry window.
      CREATE TABLE IF NOT EXISTS webhook_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        received_at TEXT NOT NULL,
        event_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        trace_id TEXT,
        payload TEXT NOT NULL,
        signature_valid INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        last_error TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status);
      CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events(received_at);
    `);
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (1)").run();
    const cols = db.prepare("PRAGMA table_info(chat_logs)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "type")) {
      db.exec("ALTER TABLE chat_logs ADD COLUMN type TEXT");
    }
    if (!cols.some((c) => c.name === "details")) {
      db.exec("ALTER TABLE chat_logs ADD COLUMN details TEXT");
    }
    if (!cols.some((c) => c.name === "source")) {
      db.exec("ALTER TABLE chat_logs ADD COLUMN source TEXT");
    }
    const syncCols = db.prepare("PRAGMA table_info(sync_logs)").all() as { name: string }[];
    if (!syncCols.some((c) => c.name === "details")) {
      db.exec("ALTER TABLE sync_logs ADD COLUMN details TEXT");
    }
    if (!syncCols.some((c) => c.name === "partial")) {
      db.exec("ALTER TABLE sync_logs ADD COLUMN partial INTEGER NOT NULL DEFAULT 0");
    }
    const routeCols = db.prepare("PRAGMA table_info(route_logs)").all() as { name: string }[];
    if (!routeCols.some((c) => c.name === "details")) {
      db.exec("ALTER TABLE route_logs ADD COLUMN details TEXT");
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
    const sleepCols = db.prepare("PRAGMA table_info(sleep)").all() as { name: string }[];
    const sleepNeedColumns = [
      "need_from_baseline_ms",
      "need_from_debt_ms",
      "need_from_strain_ms",
      "need_from_nap_ms",
    ];
    let addedSleepNeedColumn = false;
    for (const col of sleepNeedColumns) {
      if (!sleepCols.some((c) => c.name === col)) {
        db.exec(`ALTER TABLE sleep ADD COLUMN ${col} INTEGER`);
        addedSleepNeedColumn = true;
      }
    }
    if (addedSleepNeedColumn) {
      db.exec(`
        UPDATE sleep SET
          need_from_baseline_ms = COALESCE(need_from_baseline_ms, json_extract(raw, '$.score.sleep_needed.baseline_milli')),
          need_from_debt_ms = COALESCE(need_from_debt_ms, json_extract(raw, '$.score.sleep_needed.need_from_sleep_debt_milli')),
          need_from_strain_ms = COALESCE(need_from_strain_ms, json_extract(raw, '$.score.sleep_needed.need_from_recent_strain_milli')),
          need_from_nap_ms = COALESCE(need_from_nap_ms, json_extract(raw, '$.score.sleep_needed.need_from_recent_nap_milli'))
        WHERE raw IS NOT NULL
          AND (need_from_baseline_ms IS NULL OR need_from_debt_ms IS NULL OR need_from_strain_ms IS NULL OR need_from_nap_ms IS NULL)
      `);
    }
    for (const col of ["start_local", "end_local"]) {
      if (!sleepCols.some((c) => c.name === col)) {
        db.exec(`ALTER TABLE sleep ADD COLUMN ${col} TEXT`);
      }
    }
    const userCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    if (!userCols.some((c) => c.name === "apple_sub")) {
      db.exec("ALTER TABLE users ADD COLUMN apple_sub TEXT");
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_apple_sub ON users(apple_sub)");
    }
    if (!userCols.some((c) => c.name === "timezone")) {
      db.exec("ALTER TABLE users ADD COLUMN timezone TEXT");
    }
    // Case-insensitive uniqueness on email lets findOrCreateUserByEmail rely on
    // a SQLITE_CONSTRAINT race-loser to retry instead of TOCTOU SELECT+INSERT.
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(LOWER(email)) WHERE email IS NOT NULL"
    );
    // Lazy ALTER for older `integrations` rows that pre-dated key_version.
    const integrationCols = db
      .prepare("PRAGMA table_info(integrations)")
      .all() as { name: string }[];
    if (
      integrationCols.length > 0 &&
      !integrationCols.some((c) => c.name === "key_version")
    ) {
      db.exec(
        "ALTER TABLE integrations ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1"
      );
    }
    return db;
  } catch {
    db?.close();
    return null;
  }
}

/** Open the DB read-only. Returns null if the file doesn't exist yet. */
export function open(): DB | null {
  const p = dbPath();
  if (!existsSync(p)) return null;
  try {
    // No `foreign_keys = ON` here — SQLite ignores FK pragmas on read-only
    // handles, so it would just be cargo-culted noise.
    const db = new Database(p, { readonly: true, fileMustExist: true });
    return db;
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
  } catch {
    return null;
  } finally {
    db.close();
  }
}
