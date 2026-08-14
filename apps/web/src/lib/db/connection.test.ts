// @vitest-environment node
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Each test below operates on an isolated DB file. WHOOP_DB_PATH must be set
// before importing connection.ts because dbPath() reads it once at call time.
const tmpRoot = mkdtempSync(path.join(tmpdir(), "connection-db-"));

type ConnectionModule = typeof import("./connection");
let conn: ConnectionModule;

beforeAll(async () => {
  conn = await import("./connection");
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function newDbFile(): string {
  const file = path.join(
    tmpRoot,
    `db-${Math.random().toString(36).slice(2)}.db`,
  );
  new Database(file).close();
  return file;
}

function hasIndex(db: Database.Database, indexName: string): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
    )
    .get(indexName) as { name: string } | undefined;
  return !!row;
}

function columns(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  ).map((r) => r.name);
}

describe("Phase D — domain tables carry user_id", () => {
  it("fresh schema includes chat_messages.work_log", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    try {
      expect(columns(db!, "chat_messages")).toContain("work_log");
    } finally {
      db?.close();
    }
  });

  it("lazily adds work_log to an older chat schema without losing rows", () => {
    const file = newDbFile();
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        blocks TEXT,
        created_at TEXT NOT NULL,
        status TEXT DEFAULT 'complete'
      );
      INSERT INTO chat_messages (role, content, created_at)
      VALUES ('assistant', 'kept', '2026-07-30T00:00:00Z');
    `);
    raw.close();
    process.env.WHOOP_DB_PATH = file;

    const db = conn.openWrite();
    try {
      expect(columns(db!, "chat_messages")).toContain("work_log");
      expect(
        db!.prepare("SELECT content FROM chat_messages WHERE id = 1").get(),
      ).toEqual({ content: "kept" });
    } finally {
      db?.close();
    }
  });

  it("fresh DB: every domain table has user_id + composite index", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    expect(db).not.toBeNull();
    try {
      for (const t of [
        "recovery",
        "cycles",
        "sleep",
        "workouts",
        "daily_summary",
      ]) {
        expect(columns(db!, t)).toContain("user_id");
        expect(hasIndex(db!, `idx_${t}_user_date`)).toBe(true);
      }
    } finally {
      db?.close();
    }
  });

  // Every domain table is tenant-scoped by user_id, but the second key column
  // is per-table: one row per day for recovery/cycles/daily_summary, and one
  // row per SLEEP for sleep (a date carries naps plus the main sleep, so date
  // is not unique there). Asserted explicitly per table rather than assuming a
  // uniform (user_id, date) — that assumption is what silently rotted here.
  it("domain tables: PRIMARY KEY is user_id + the right per-table key", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    const expectedPk: Record<string, string[]> = {
      recovery: ["user_id", "date"],
      cycles: ["user_id", "date"],
      daily_summary: ["user_id", "date"],
      sleep: ["user_id", "sleep_id"],
      // Many workouts per day, keyed by Whoop's own id. Included so all five
      // domain tables named in CLAUDE.md are covered — omitting it is how the
      // uniform-(user_id, date) misconception survived in the first place.
      workouts: ["id"],
    };
    try {
      for (const t of ["recovery", "cycles", "sleep", "daily_summary", "workouts"]) {
        const pkCols = (
          db!
            .prepare(`PRAGMA table_info(${t})`)
            .all() as { name: string; pk: number }[]
        )
          .filter((c) => c.pk > 0)
          .sort((a, b) => a.pk - b.pk)
          .map((c) => c.name);
        expect(pkCols, `${t} pk`).toEqual(expectedPk[t]);
      }
    } finally {
      db?.close();
    }
  });

  it("integrations: provider_user_id column + composite index", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    try {
      expect(columns(db!, "integrations")).toContain("provider_user_id");
      expect(hasIndex(db!, "idx_integrations_provider_user")).toBe(true);
    } finally {
      db?.close();
    }
  });

  it("re-opening the DB is idempotent (migration runs only once)", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    conn.openWrite()?.close();
    // Second open should not throw and should preserve the composite PK.
    const db = conn.openWrite();
    try {
      const pkCols = (
        db!
          .prepare(`PRAGMA table_info(recovery)`)
          .all() as { name: string; pk: number }[]
      )
        .filter((c) => c.pk > 0)
        .map((c) => c.name);
      expect(pkCols.sort()).toEqual(["date", "user_id"]);
    } finally {
      db?.close();
    }
  });

  it("workouts ALTER survives a pre-existing table when foreign_keys=ON", () => {
    // Prod scenario: a DB created by the pre-Phase-D schema already has
    // a `workouts` table with rows; opening it under FK=ON used to throw
    // `SQLITE_ERROR: Cannot add a REFERENCES column with non-NULL default
    // value` at the ALTER. Regression for fix/phase-d-workouts-fk-alter.
    const file = newDbFile();
    const raw = new Database(file);
    raw.pragma("foreign_keys = ON");
    raw.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        apple_sub TEXT UNIQUE,
        email TEXT,
        name TEXT,
        timezone TEXT
      );
      INSERT INTO users (id) VALUES (1);
      CREATE TABLE workouts (
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
      INSERT INTO workouts (id, date, sport) VALUES ('w1', '2025-04-12', 'run');
    `);
    raw.close();

    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    expect(db).not.toBeNull();
    try {
      expect(columns(db!, "workouts")).toContain("user_id");
      const row = db!
        .prepare("SELECT user_id, sport FROM workouts WHERE id = ?")
        .get("w1") as { user_id: number; sport: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.user_id).toBe(1);
      expect(row!.sport).toBe("run");
      // FK enforcement is restored.
      expect((db! as Database.Database).pragma("foreign_keys", { simple: true })).toBe(1);
    } finally {
      db?.close();
    }
  });

  it("route_logs: fresh DB has the issue #296 perf columns", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    try {
      const cols = columns(db!, "route_logs");
      expect(cols).toEqual(
        expect.arrayContaining(["response_bytes", "render_ms"])
      );
    } finally {
      db?.close();
    }
  });

  it("route_logs: lazy ALTER backfills perf columns on a pre-#296 DB without losing rows", () => {
    const file = newDbFile();
    // Mimic a prod DB that pre-dates issue #296: route_logs exists with the
    // older schema (status + details only) and already has rows. The lazy
    // ALTER must add the new columns AND leave existing rows intact with
    // NULLs for the new fields — that's the "no migration" guarantee.
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE route_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        route TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        status INTEGER NOT NULL,
        details TEXT
      );
      INSERT INTO route_logs (started_at, route, duration_ms, status, details)
      VALUES ('2026-05-13T12:00:00Z', '/recovery', 120, 200, '{"method":"GET"}');
    `);
    raw.close();

    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    try {
      const cols = columns(db!, "route_logs");
      for (const c of ["response_bytes", "render_ms"]) {
        expect(cols).toContain(c);
      }
      const row = db!
        .prepare(
          "SELECT route, status, response_bytes, render_ms FROM route_logs WHERE id = 1"
        )
        .get() as {
          route: string;
          status: number;
          response_bytes: number | null;
          render_ms: number | null;
        };
      expect(row.route).toBe("/recovery");
      expect(row.status).toBe(200);
      expect(row.response_bytes).toBeNull();
      expect(row.render_ms).toBeNull();
    } finally {
      db?.close();
    }
  });

  // -------------------------------------------------------------------------
  // Issue #494 — user_id on chat_logs / sync_logs / journal.
  // -------------------------------------------------------------------------

  it("issue #494: fresh DB has user_id + index on chat_logs and sync_logs", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    try {
      expect(columns(db!, "chat_logs")).toContain("user_id");
      expect(columns(db!, "sync_logs")).toContain("user_id");
      expect(hasIndex(db!, "idx_chat_logs_user")).toBe(true);
      expect(hasIndex(db!, "idx_sync_logs_user")).toBe(true);
    } finally {
      db?.close();
    }
  });

  it("issue #494: lazy ALTER adds user_id to a pre-#494 log schema without losing rows", () => {
    const file = newDbFile();
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE chat_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        prompt_preview TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        response_length INTEGER NOT NULL,
        error_message TEXT,
        days_context INTEGER
      );
      INSERT INTO chat_logs (started_at, prompt_preview, duration_ms, status, response_length)
      VALUES ('2026-05-01T00:00:00Z', 'legacy prompt', 42, 'ok', 7);
      CREATE TABLE sync_logs (
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
      INSERT INTO sync_logs (started_at, duration_ms, status, source)
      VALUES ('2026-05-01T00:00:00Z', 900, 'ok', 'manual');
    `);
    raw.close();

    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    try {
      expect(columns(db!, "chat_logs")).toContain("user_id");
      expect(columns(db!, "sync_logs")).toContain("user_id");
      const chat = db!
        .prepare("SELECT prompt_preview, duration_ms FROM chat_logs WHERE id = 1")
        .get() as { prompt_preview: string; duration_ms: number };
      expect(chat.prompt_preview).toBe("legacy prompt");
      expect(chat.duration_ms).toBe(42);
      const sync = db!
        .prepare("SELECT source FROM sync_logs WHERE id = 1")
        .get() as { source: string };
      expect(sync.source).toBe("manual");
    } finally {
      db?.close();
    }
  });

  // Backfill policy: legacy rows carry no user_id and would otherwise be
  // invisible to everyone. On a single-account DB (the production shape) we
  // claim them for that account so the maintainer's log history survives.
  it("issue #494: single-user DB backfills legacy log rows to the sole account", () => {
    const file = newDbFile();
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE chat_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        prompt_preview TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        response_length INTEGER NOT NULL,
        error_message TEXT,
        days_context INTEGER
      );
      INSERT INTO chat_logs (started_at, prompt_preview, duration_ms, status, response_length)
      VALUES ('2026-05-01T00:00:00Z', 'legacy prompt', 42, 'ok', 7);
      CREATE TABLE sync_logs (
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
      INSERT INTO sync_logs (started_at, duration_ms, status, source)
      VALUES ('2026-05-01T00:00:00Z', 900, 'ok', 'manual');
      CREATE TABLE journal (
        date TEXT PRIMARY KEY,
        title TEXT,
        content TEXT,
        mood TEXT,
        tags TEXT
      );
      INSERT INTO journal (date, title) VALUES ('2026-05-01', 'legacy entry');
    `);
    raw.close();

    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    try {
      for (const table of ["chat_logs", "sync_logs", "journal"]) {
        const orphans = db!
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id IS NULL`)
          .get() as { n: number };
        expect(orphans.n, `${table} orphans`).toBe(0);
        const claimed = db!
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = 1`)
          .get() as { n: number };
        expect(claimed.n, `${table} claimed`).toBe(1);
      }
    } finally {
      db?.close();
    }
  });

  // The other half of the policy: with more than one account there is no
  // defensible owner, so legacy rows stay NULL and stay unreadable. Guessing
  // here would be the very cross-tenant leak this change closes.
  it("issue #494: multi-user DB leaves legacy rows NULL (fails closed)", () => {
    const file = newDbFile();
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        apple_sub TEXT UNIQUE,
        email TEXT,
        name TEXT,
        timezone TEXT
      );
      INSERT INTO users (id) VALUES (1);
      INSERT INTO users (id) VALUES (2);
      CREATE TABLE chat_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        prompt_preview TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        response_length INTEGER NOT NULL,
        error_message TEXT,
        days_context INTEGER
      );
      INSERT INTO chat_logs (started_at, prompt_preview, duration_ms, status, response_length)
      VALUES ('2026-05-01T00:00:00Z', 'ambiguous legacy prompt', 42, 'ok', 7);
    `);
    raw.close();

    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    try {
      const row = db!
        .prepare("SELECT user_id FROM chat_logs WHERE id = 1")
        .get() as { user_id: number | null };
      expect(row.user_id).toBeNull();
    } finally {
      db?.close();
    }
  });

  it("issue #494: journal ALTER is skipped when the table does not exist", () => {
    // The production DB has no `journal` table and this app never creates one
    // — opening must not throw, and must not conjure the table.
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    expect(db).not.toBeNull();
    try {
      const row = db!
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='journal'")
        .get();
      expect(row).toBeUndefined();
    } finally {
      db?.close();
    }
  });

  it("issue #494: the migration is idempotent across repeated opens", () => {
    const file = newDbFile();
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE journal (
        date TEXT PRIMARY KEY,
        title TEXT,
        content TEXT,
        mood TEXT,
        tags TEXT
      );
      INSERT INTO journal (date, title) VALUES ('2026-05-01', 'entry');
    `);
    raw.close();
    process.env.WHOOP_DB_PATH = file;

    // Three opens: first migrates, the rest must be clean no-ops.
    conn.openWrite()?.close();
    conn.openWrite()?.close();
    const db = conn.openWrite();
    expect(db).not.toBeNull();
    try {
      for (const table of ["chat_logs", "sync_logs", "journal"]) {
        expect(
          columns(db!, table).filter((c) => c === "user_id"),
          `${table} user_id count`,
        ).toEqual(["user_id"]);
      }
      expect(hasIndex(db!, "idx_journal_user_date")).toBe(true);
      const rows = db!
        .prepare("SELECT COUNT(*) AS n FROM journal")
        .get() as { n: number };
      expect(rows.n).toBe(1);
    } finally {
      db?.close();
    }
  });

  it("backfills existing pre-migration rows to user_id=1", () => {
    const file = newDbFile();
    // Build a pre-migration recovery table (no user_id column) and seed a row.
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE recovery (
        date TEXT PRIMARY KEY,
        recovery_score REAL,
        hrv REAL,
        rhr REAL,
        spo2 REAL,
        skin_temp REAL,
        raw JSON
      );
      INSERT INTO recovery (date, recovery_score) VALUES ('2025-04-12', 75);
    `);
    raw.close();

    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    try {
      const row = db!
        .prepare(
          "SELECT user_id, date, recovery_score FROM recovery WHERE date = ?",
        )
        .get("2025-04-12") as
        | { user_id: number; date: string; recovery_score: number }
        | undefined;
      expect(row).toBeDefined();
      expect(row!.user_id).toBe(1);
      expect(row!.recovery_score).toBe(75);
    } finally {
      db?.close();
    }
  });
});
