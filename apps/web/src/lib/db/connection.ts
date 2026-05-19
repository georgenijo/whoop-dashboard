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
        created_at TEXT NOT NULL,
        status TEXT DEFAULT 'complete'
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
        details TEXT,
        thread_id INTEGER REFERENCES chat_threads(id)
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
        details TEXT,
        response_bytes INTEGER,
        render_ms INTEGER
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
      -- (singular) to match the Whoop OAuth response shape.
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
        needs_reauth INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, provider)
      );
      -- Per-provider lookup for the Phase C sync orchestrator (iterate every
      -- user with a Whoop integration, schedule a refresh).
      CREATE INDEX IF NOT EXISTS idx_integrations_provider ON integrations(provider);
      -- Per-user app preferences. Single typed row per user. anthropic_key
      -- is encrypted via NaCl secretbox (same key/key_version scheme as
      -- integrations); NULL means "use server fallback". Other columns are
      -- plaintext and nullable until the user sets a preference.
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        anthropic_key TEXT,
        anthropic_key_version INTEGER,
        model_pref TEXT,
        timezone TEXT,
        monthly_token_cap INTEGER,
        coach_goals TEXT,
        onboarded_at TEXT,
        tz TEXT,
        updated_at TEXT NOT NULL
      );
      -- APNs device tokens for push notifications. Composite PK on
      -- (user_id, token); UNIQUE INDEX on token alone so a token reappearing
      -- under a different user_id (device handed off) is detectable as a
      -- conflict and resolved via INSERT … ON CONFLICT(token) DO UPDATE.
      CREATE TABLE IF NOT EXISTS device_tokens (
        user_id INTEGER NOT NULL REFERENCES users(id),
        token TEXT NOT NULL,
        platform TEXT NOT NULL,
        env TEXT NOT NULL,
        app_version TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, token)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_device_tokens_token ON device_tokens(token);
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
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        last_error TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status);
      CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events(received_at);
      -- Issue #388 — unified logs view storage.
      --  server_logs: warn+ events from the backend logger module. INFO stays
      --  in journald (volume control). Use module + trace_id to correlate.
      --  client_logs: errors, pageviews, key clicks, lifecycle from web + iOS.
      --  source='web'|'ios' distinguishes; kind='error'|'pageview'|'click'|
      --  'lifecycle'|'event' is the routable type. Both feed the unified
      --  /logs timeline.
      CREATE TABLE IF NOT EXISTS server_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        level TEXT NOT NULL,
        module TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT,
        user_id INTEGER,
        trace_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_server_logs_created ON server_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_server_logs_level ON server_logs(level);
      CREATE INDEX IF NOT EXISTS idx_server_logs_module ON server_logs(module);
      CREATE TABLE IF NOT EXISTS client_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        source TEXT NOT NULL,
        level TEXT NOT NULL,
        kind TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        user_agent TEXT,
        app_version TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_client_logs_created ON client_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_client_logs_source ON client_logs(source);
      CREATE INDEX IF NOT EXISTS idx_client_logs_kind ON client_logs(kind);
      CREATE INDEX IF NOT EXISTS idx_client_logs_user_created
        ON client_logs(user_id, created_at DESC);
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
    if (!cols.some((c) => c.name === "thread_id")) {
      db.exec("ALTER TABLE chat_logs ADD COLUMN thread_id INTEGER REFERENCES chat_threads(id)");
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_chat_logs_thread ON chat_logs(thread_id, id DESC)");
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
    // Issue #296 — page-render perf signal. response_bytes always NULL
    // (Next.js 16 `after()` has no handle on the streamed response body).
    if (!routeCols.some((c) => c.name === "response_bytes")) {
      db.exec("ALTER TABLE route_logs ADD COLUMN response_bytes INTEGER");
    }
    if (!routeCols.some((c) => c.name === "render_ms")) {
      db.exec("ALTER TABLE route_logs ADD COLUMN render_ms INTEGER");
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
    if (!chatCols.some((c) => c.name === "status")) {
      db.exec("ALTER TABLE chat_messages ADD COLUMN status TEXT DEFAULT 'complete'");
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
    // Case-insensitive uniqueness on email — guards against duplicate user rows
    // across SIWA merges and (future) Google sign-in.
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
    if (
      integrationCols.length > 0 &&
      !integrationCols.some((c) => c.name === "needs_reauth")
    ) {
      db.exec(
        "ALTER TABLE integrations ADD COLUMN needs_reauth INTEGER NOT NULL DEFAULT 0"
      );
    }
    // Phase D — provider_user_id maps a remote provider's user id (e.g.
    // Whoop's `evt.user_id` in webhook payloads) → our local user_id, so
    // webhook events arrive at the right tenant. Populated in the OAuth
    // callback and lazy-backfilled from `runWhoopSync`. NULL until the first
    // profile fetch succeeds.
    if (
      integrationCols.length > 0 &&
      !integrationCols.some((c) => c.name === "provider_user_id")
    ) {
      db.exec("ALTER TABLE integrations ADD COLUMN provider_user_id TEXT");
    }
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_integrations_provider_user ON integrations(provider, provider_user_id)"
    );

    // Phase E.1 — welcome wizard. Three plaintext columns on user_settings:
    //   - coach_goals: JSON-encoded `string[]` of canonical goal IDs
    //   - onboarded_at: ISO 8601 set-once stamp; gates the /welcome redirect
    //   - tz: IANA timezone, captured write-once during the wizard
    // Fresh DBs get these via the bootstrap CREATE above. The ALTERs below
    // exist for existing prod DBs that pre-date Phase E.1; each is gated by a
    // PRAGMA check so a re-run doesn't crash boot.
    const userSettingsCols = db
      .prepare("PRAGMA table_info(user_settings)")
      .all() as { name: string }[];
    if (!userSettingsCols.some((c) => c.name === "coach_goals")) {
      db.exec("ALTER TABLE user_settings ADD COLUMN coach_goals TEXT");
    }
    if (!userSettingsCols.some((c) => c.name === "onboarded_at")) {
      db.exec("ALTER TABLE user_settings ADD COLUMN onboarded_at TEXT");
    }
    if (!userSettingsCols.some((c) => c.name === "tz")) {
      db.exec("ALTER TABLE user_settings ADD COLUMN tz TEXT");
    }

    // Phase D — data isolation. Add `user_id` to the five domain tables so
    // every read / write is tenant-scoped. For recovery / cycles / sleep /
    // daily_summary the PK changes from `date` to composite `(user_id,
    // date)` — SQLite can't ALTER a PK, so each is a table rebuild gated by
    // a "no user_id column" check.
    rebuildDomainTablesForUserId(db);
    rebuildSleepForSleepId(db);
    return db;
  } catch (err) {
    // Surfacing the error is critical: silent null returns hide schema
    // migration bugs (e.g. ALTER ADD COLUMN with FK + non-NULL DEFAULT
    // under foreign_keys=ON). Log to stderr; callers still get null and
    // can decide what to do.
    console.error("[openWrite] migration failed:", err);
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

/**
 * Sanitize a `days` LIMIT value so it can be safely inlined as a SQL literal.
 * Inlining lets `user_id = ?` remain the trailing placeholder — the wrapper's
 * binding convention. Defaults to 30 on invalid input; capped at 3650 (~10y)
 * to keep degenerate inputs from melting the DB.
 */
export function safeDays(days: number): number {
  if (!Number.isFinite(days)) return 30;
  const n = Math.floor(days);
  if (n <= 0) return 30;
  return Math.min(n, 3650);
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

// ---------------------------------------------------------------------------
// Phase D — domain-table user_id migration
// ---------------------------------------------------------------------------

type RebuildPlan = {
  table: "recovery" | "cycles" | "sleep" | "daily_summary";
  /** Full CREATE TABLE statement for the new shape, named <table>_new.
   *  PRIMARY KEY is composite (user_id, date). */
  createNewSql: string;
  /** Column list to copy from the old table — must omit user_id, which is
   *  injected as the literal `1` in the SELECT. Old PK was `date`, so the
   *  row count is preserved 1:1. */
  copyColumns: string;
};

const REBUILD_PLANS: RebuildPlan[] = [
  {
    table: "recovery",
    createNewSql: `
      CREATE TABLE recovery_new (
        user_id INTEGER NOT NULL REFERENCES users(id) DEFAULT 1,
        date TEXT NOT NULL,
        recovery_score REAL,
        hrv REAL,
        rhr REAL,
        spo2 REAL,
        skin_temp REAL,
        raw JSON,
        PRIMARY KEY (user_id, date)
      )
    `,
    copyColumns: "date, recovery_score, hrv, rhr, spo2, skin_temp, raw",
  },
  {
    table: "cycles",
    createNewSql: `
      CREATE TABLE cycles_new (
        user_id INTEGER NOT NULL REFERENCES users(id) DEFAULT 1,
        date TEXT NOT NULL,
        strain REAL,
        kilojoule REAL,
        avg_hr INTEGER,
        max_hr INTEGER,
        raw JSON,
        PRIMARY KEY (user_id, date)
      )
    `,
    copyColumns: "date, strain, kilojoule, avg_hr, max_hr, raw",
  },
  {
    table: "sleep",
    createNewSql: `
      CREATE TABLE sleep_new (
        user_id INTEGER NOT NULL REFERENCES users(id) DEFAULT 1,
        date TEXT NOT NULL,
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
        start_local TEXT,
        end_local TEXT,
        raw JSON,
        PRIMARY KEY (user_id, date)
      )
    `,
    copyColumns:
      "date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms, " +
      "performance, efficiency, consistency, respiratory_rate, disturbances, " +
      "cycles, nap, need_from_baseline_ms, need_from_debt_ms, " +
      "need_from_strain_ms, need_from_nap_ms, start_local, end_local, raw",
  },
  {
    table: "daily_summary",
    createNewSql: `
      CREATE TABLE daily_summary_new (
        user_id INTEGER NOT NULL REFERENCES users(id) DEFAULT 1,
        date TEXT NOT NULL,
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
        computed_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, date)
      )
    `,
    copyColumns:
      "date, recovery_score, hrv_ms, resting_hr, sleep_hours, " +
      "sleep_efficiency, sleep_performance, day_strain, max_hr, avg_hr, " +
      "kilojoules, workouts_count, computed_at",
  },
];

function rebuildDomainTablesForUserId(db: DB): void {
  // PK-rebuilds for recovery / cycles / sleep / daily_summary. Each runs
  // inside its own transaction with FK enforcement temporarily off (so the
  // DROP+RENAME isn't rejected by transient self-references). After the
  // rebuild we re-enable FK and re-create the per-user composite index.
  for (const plan of REBUILD_PLANS) {
    if (hasColumn(db, plan.table, "user_id")) {
      // Already migrated — just ensure the composite index exists.
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_${plan.table}_user_date ON ${plan.table}(user_id, date DESC)`
      );
      continue;
    }
    // Capture every user-defined index on the old table so we can replay it
    // after the rename. Skips auto-indexes and the composite (which we always
    // (re)create explicitly below). Belt-and-suspenders against future
    // contributors adding a custom index in the schema bootstrap without
    // remembering this rebuild path.
    const preserved = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name = ? " +
          "AND name NOT LIKE 'sqlite_autoindex_%' AND name <> ?"
      )
      .all(plan.table, `idx_${plan.table}_user_date`) as {
      sql: string | null;
    }[];
    const preservedSql = preserved
      .map((r) => r.sql)
      .filter((s): s is string => !!s);

    db.pragma("foreign_keys = OFF");
    try {
      const tx = db.transaction(() => {
        db.exec(plan.createNewSql);
        db.exec(
          `INSERT INTO ${plan.table}_new (user_id, ${plan.copyColumns}) ` +
            `SELECT 1, ${plan.copyColumns} FROM ${plan.table}`
        );
        db.exec(`DROP TABLE ${plan.table}`);
        db.exec(`ALTER TABLE ${plan.table}_new RENAME TO ${plan.table}`);
        db.exec(
          `CREATE INDEX IF NOT EXISTS idx_${plan.table}_user_date ON ${plan.table}(user_id, date DESC)`
        );
        for (const indexSql of preservedSql) {
          db.exec(indexSql);
        }
      });
      tx();
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }

  // workouts: PK is `id`, so a simple ALTER ADD COLUMN suffices. SQLite
  // refuses an ADD COLUMN with REFERENCES + non-NULL DEFAULT while
  // `foreign_keys = ON` (https://sqlite.org/lang_altertable.html). Disable
  // FK enforcement around the ALTER, matching the PK-rebuild loop above.
  // Without this guard, the ALTER throws SQLITE_ERROR on any prod DB where
  // FK is enabled (which is every Whoop dashboard DB).
  if (!hasColumn(db, "workouts", "user_id")) {
    db.pragma("foreign_keys = OFF");
    try {
      db.exec(
        "ALTER TABLE workouts ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id)"
      );
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts(user_id, date DESC)"
  );

  // Belt-and-suspenders backfill: DEFAULT 1 already covers new rows, but a
  // table that was created without DEFAULT (e.g. via a non-openWrite path)
  // could still hold NULLs. Cheap to enforce.
  for (const table of ["recovery", "cycles", "sleep", "daily_summary", "workouts"]) {
    db.exec(`UPDATE ${table} SET user_id = 1 WHERE user_id IS NULL`);
  }

  // Fail-fast assertion. If any of the five tables somehow finished the
  // migration without a `user_id` column, refuse to proceed — silently
  // syncing into an un-scoped table would mix tenants' data.
  for (const table of ["recovery", "cycles", "sleep", "daily_summary", "workouts"]) {
    if (!hasColumn(db, table, "user_id")) {
      throw new Error(
        `[connection] migration failed: ${table} is missing user_id column`
      );
    }
  }
}

// Second sleep-table rebuild — switch PK from (user_id, date) to
// (user_id, sleep_id). Whoop returns multiple sleep records per local date
// (night + nap), so a (user_id, date)-keyed table forced the second write to
// clobber the first. New PK uses the Whoop sleep UUID directly so naps and
// night sleep coexist.
function rebuildSleepForSleepId(db: DB): void {
  if (!hasColumn(db, "sleep", "user_id")) return;
  if (hasColumn(db, "sleep", "sleep_id")) return;

  db.pragma("foreign_keys = OFF");
  try {
    const tx = db.transaction(() => {
      db.exec(`
        CREATE TABLE sleep_new (
          user_id INTEGER NOT NULL REFERENCES users(id) DEFAULT 1,
          sleep_id TEXT NOT NULL,
          date TEXT NOT NULL,
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
          start_local TEXT,
          end_local TEXT,
          raw JSON,
          PRIMARY KEY (user_id, sleep_id)
        )
      `);
      // Backfill sleep_id from raw.id; for any row where raw is null (legacy
      // bootstrap edge-cases) we fall back to a synthetic key so the copy
      // doesn't fail the NOT NULL constraint.
      db.exec(`
        INSERT INTO sleep_new
          (user_id, sleep_id, date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms,
           sleep_need_ms, performance, efficiency, consistency, respiratory_rate,
           disturbances, cycles, nap,
           need_from_baseline_ms, need_from_debt_ms, need_from_strain_ms, need_from_nap_ms,
           start_local, end_local, raw)
        SELECT
          user_id,
          COALESCE(json_extract(raw, '$.id'), user_id || ':' || date || ':' || COALESCE(nap, 0)),
          date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms,
          sleep_need_ms, performance, efficiency, consistency, respiratory_rate,
          disturbances, cycles, nap,
          need_from_baseline_ms, need_from_debt_ms, need_from_strain_ms, need_from_nap_ms,
          start_local, end_local, raw
        FROM sleep
      `);
      db.exec("DROP TABLE sleep");
      db.exec("ALTER TABLE sleep_new RENAME TO sleep");
      db.exec("CREATE INDEX IF NOT EXISTS idx_sleep_user_date ON sleep(user_id, date DESC)");
    });
    tx();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
