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
type AuthModule = typeof import("./auth");
let conn: ConnectionModule;
let authMod: AuthModule;

beforeAll(async () => {
  conn = await import("./connection");
  authMod = await import("./auth");
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

// ---------------------------------------------------------------------------
// Issue #502 review — reflection helpers for the USER_FK_TABLES /
// KNOWN_UNMERGED_USER_FK_TABLES guard test below. These read the live schema
// (PRAGMA table_info / index_list / index_info / foreign_key_list) rather
// than trusting either hand-maintained list's doc comment, so "is it actually
// safe to repoint this table with a bare UPDATE" is an assertion, not prose.
// ---------------------------------------------------------------------------

/** True if `user_id` is part of `table`'s PRIMARY KEY (single- or composite-key). */
function userIdInPrimaryKey(db: Database.Database, table: string): boolean {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
    pk: number;
  }[];
  return info.some((c) => c.name === "user_id" && c.pk > 0);
}

/** True if `user_id` is a member of any UNIQUE index on `table`. */
function userIdInUniqueIndex(db: Database.Database, table: string): boolean {
  const indexes = db.prepare(`PRAGMA index_list(${table})`).all() as {
    name: string;
    unique: number;
  }[];
  for (const idx of indexes) {
    if (!idx.unique) continue;
    const idxCols = db.prepare(`PRAGMA index_info(${idx.name})`).all() as {
      name: string;
    }[];
    if (idxCols.some((c) => c.name === "user_id")) return true;
  }
  return false;
}

/**
 * True if `user_id` sits in a PRIMARY KEY or UNIQUE index — the condition
 * that makes a bare `UPDATE ... SET user_id` repoint unsafe (it would trade
 * today's FK failure for a UNIQUE constraint failure whenever both merging
 * accounts hold a matching row).
 */
function userIdConstrainsUniqueness(db: Database.Database, table: string): boolean {
  return userIdInPrimaryKey(db, table) || userIdInUniqueIndex(db, table);
}

/**
 * True if `table` declares an FK from `user_id` to `users(id)` with an
 * ON DELETE action (CASCADE, SET NULL, etc. — anything but the SQLite
 * default "NO ACTION"). An action here means leaving the table out of
 * USER_FK_TABLES doesn't fail loudly at merge time — it silently cascades or
 * detaches instead, which is its own kind of unsafe (see the chat_attachments
 * cascade-data-loss case fixed in issue #502).
 */
function userIdFkHasOnDeleteAction(db: Database.Database, table: string): boolean {
  const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as {
    table: string;
    from: string;
    on_delete: string;
  }[];
  return fks.some(
    (fk) => fk.table === "users" && fk.from === "user_id" && fk.on_delete !== "NO ACTION",
  );
}

/**
 * Every table in the live schema that carries a `user_id` column — unioned
 * with tables that declare an FK to users(id) under some other column name,
 * though in practice every FK-to-users column in this schema is named
 * user_id. Column presence alone (not "does it declare a REFERENCES
 * clause") is what makes this catch workout_plans and server_logs: both
 * carry a plain `user_id INTEGER` with no REFERENCES clause, so a
 * declared-FK-only reflection is blind to them even though mergeUserInto
 * silently orphans their rows on every split-brain merge.
 */
function tablesWithUserIdOrFk(db: Database.Database, tables: string[]): Set<string> {
  const candidates = new Set<string>();
  for (const table of tables) {
    if (columns(db, table).includes("user_id")) {
      candidates.add(table);
      continue;
    }
    const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as {
      table: string;
    }[];
    if (fks.some((fk) => fk.table === "users")) candidates.add(table);
  }
  return candidates;
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

  it("fresh DB: user_settings has a system_prompt column (issue #493)", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    try {
      expect(columns(db!, "user_settings")).toContain("system_prompt");
    } finally {
      db?.close();
    }
  });

  it("lazily adds system_prompt to a pre-#493 user_settings table without losing rows", () => {
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
      CREATE TABLE user_settings (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        anthropic_key TEXT,
        anthropic_key_version INTEGER,
        model_pref TEXT,
        timezone TEXT,
        monthly_token_cap INTEGER,
        updated_at TEXT NOT NULL
      );
      INSERT INTO user_settings (user_id, model_pref, updated_at)
      VALUES (1, 'claude-sonnet-4-6', '2026-01-01T00:00:00Z');
    `);
    raw.close();
    process.env.WHOOP_DB_PATH = file;

    const db = conn.openWrite();
    try {
      expect(columns(db!, "user_settings")).toContain("system_prompt");
      const row = db!
        .prepare("SELECT model_pref, system_prompt FROM user_settings WHERE user_id = 1")
        .get() as { model_pref: string; system_prompt: string | null };
      expect(row.model_pref).toBe("claude-sonnet-4-6");
      expect(row.system_prompt).toBeNull();
    } finally {
      db?.close();
    }
  });

  it("re-opening the DB after the system_prompt ALTER is idempotent", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    conn.openWrite()?.close();
    conn.openWrite()?.close();
    const db = conn.openWrite();
    try {
      expect(columns(db!, "user_settings")).toContain("system_prompt");
    } finally {
      db?.close();
    }
  });

  // -------------------------------------------------------------------------
  // Issue #493 follow-up (fable review, MEDIUM) — one-time migration off the
  // legacy app-global system_prompt row into per-user user_settings.
  // -------------------------------------------------------------------------

  function seedLegacyGlobalPrompt(
    file: string,
    opts: {
      users: { id: number; system_prompt?: string | null; hasRow?: boolean }[];
      legacyValue: string | null;
    },
  ) {
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        apple_sub TEXT UNIQUE,
        email TEXT,
        name TEXT,
        timezone TEXT
      );
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE user_settings (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        anthropic_key TEXT,
        anthropic_key_version INTEGER,
        model_pref TEXT,
        system_prompt TEXT,
        updated_at TEXT NOT NULL
      );
    `);
    for (const u of opts.users) {
      raw.prepare("INSERT INTO users (id) VALUES (?)").run(u.id);
      if (u.hasRow !== false) {
        raw
          .prepare(
            "INSERT INTO user_settings (user_id, system_prompt, updated_at) VALUES (?, ?, ?)",
          )
          .run(u.id, u.system_prompt ?? null, "2026-01-01T00:00:00Z");
      }
    }
    if (opts.legacyValue !== null) {
      raw
        .prepare("INSERT INTO app_settings (key, value) VALUES ('system_prompt', ?)")
        .run(opts.legacyValue);
    }
    raw.close();
  }

  it("migrates the legacy global value to the sole user and deletes the app_settings row", () => {
    const file = newDbFile();
    seedLegacyGlobalPrompt(file, {
      users: [{ id: 1 }],
      legacyValue: "be terse and cite HRV",
    });
    process.env.WHOOP_DB_PATH = file;

    const db = conn.openWrite();
    try {
      const row = db!
        .prepare("SELECT system_prompt FROM user_settings WHERE user_id = 1")
        .get() as { system_prompt: string | null };
      expect(row.system_prompt).toBe("be terse and cite HRV");

      const legacy = db!
        .prepare("SELECT value FROM app_settings WHERE key = 'system_prompt'")
        .get();
      expect(legacy).toBeUndefined();
    } finally {
      db?.close();
    }
  });

  it("migration is idempotent across repeated openWrite() calls", () => {
    const file = newDbFile();
    seedLegacyGlobalPrompt(file, {
      users: [{ id: 1 }],
      legacyValue: "be terse and cite HRV",
    });
    process.env.WHOOP_DB_PATH = file;

    // First open migrates; the row is gone, so subsequent opens must be
    // cheap no-ops that don't throw and don't disturb the migrated value.
    conn.openWrite()?.close();
    conn.openWrite()?.close();
    const db = conn.openWrite();
    try {
      const row = db!
        .prepare("SELECT system_prompt FROM user_settings WHERE user_id = 1")
        .get() as { system_prompt: string | null };
      expect(row.system_prompt).toBe("be terse and cite HRV");
      const legacy = db!
        .prepare("SELECT value FROM app_settings WHERE key = 'system_prompt'")
        .get();
      expect(legacy).toBeUndefined();
    } finally {
      db?.close();
    }
  });

  it("a user with no per-user value inherits the migrated legacy value", () => {
    const file = newDbFile();
    seedLegacyGlobalPrompt(file, {
      users: [
        { id: 1, system_prompt: null },
        { id: 2, system_prompt: null },
      ],
      legacyValue: "shared legacy instructions",
    });
    process.env.WHOOP_DB_PATH = file;

    const db = conn.openWrite();
    try {
      for (const id of [1, 2]) {
        const row = db!
          .prepare("SELECT system_prompt FROM user_settings WHERE user_id = ?")
          .get(id) as { system_prompt: string | null };
        expect(row.system_prompt).toBe("shared legacy instructions");
      }
    } finally {
      db?.close();
    }
  });

  it("a user who already had a per-user value keeps theirs, not the legacy value", () => {
    const file = newDbFile();
    seedLegacyGlobalPrompt(file, {
      users: [
        { id: 1, system_prompt: "user one already set this" },
        { id: 2, system_prompt: null },
      ],
      legacyValue: "shared legacy instructions",
    });
    process.env.WHOOP_DB_PATH = file;

    const db = conn.openWrite();
    try {
      const userOne = db!
        .prepare("SELECT system_prompt FROM user_settings WHERE user_id = 1")
        .get() as { system_prompt: string | null };
      expect(userOne.system_prompt).toBe("user one already set this");

      const userTwo = db!
        .prepare("SELECT system_prompt FROM user_settings WHERE user_id = 2")
        .get() as { system_prompt: string | null };
      expect(userTwo.system_prompt).toBe("shared legacy instructions");
    } finally {
      db?.close();
    }
  });

  it("creates a user_settings row for a user that doesn't have one yet (insert path)", () => {
    const file = newDbFile();
    // hasRow: false — user 1 exists in `users` but has never touched
    // user_settings, so there is no row for the migration to UPDATE.
    seedLegacyGlobalPrompt(file, {
      users: [{ id: 1, hasRow: false }],
      legacyValue: "legacy instructions",
    });
    process.env.WHOOP_DB_PATH = file;

    const db = conn.openWrite();
    try {
      const row = db!
        .prepare("SELECT system_prompt FROM user_settings WHERE user_id = 1")
        .get() as { system_prompt: string | null } | undefined;
      expect(row).toBeDefined();
      expect(row!.system_prompt).toBe("legacy instructions");
    } finally {
      db?.close();
    }
  });

  it("leaves an empty-string legacy value untouched (no migration, row survives)", () => {
    const file = newDbFile();
    seedLegacyGlobalPrompt(file, {
      users: [{ id: 1 }],
      legacyValue: "",
    });
    process.env.WHOOP_DB_PATH = file;

    const db = conn.openWrite();
    try {
      const row = db!
        .prepare("SELECT system_prompt FROM user_settings WHERE user_id = 1")
        .get() as { system_prompt: string | null };
      expect(row.system_prompt).toBeNull();
      // Harmless either way — nothing reads app_settings.system_prompt any
      // more — but documenting the chosen behavior: an empty value is not
      // treated as "present" so it is not copied or cleaned up.
      const legacy = db!
        .prepare("SELECT value FROM app_settings WHERE key = 'system_prompt'")
        .get();
      expect(legacy).toEqual({ value: "" });
    } finally {
      db?.close();
    }
  });

  it("no-op when there is no legacy app_settings row at all", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    // Fresh DB, never had a legacy global row — must not throw.
    const db = conn.openWrite();
    expect(db).not.toBeNull();
    db?.close();
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
  // Issue #499 — user_id on route_logs.
  // -------------------------------------------------------------------------

  it("issue #499: fresh DB has user_id + index on route_logs", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    try {
      expect(columns(db!, "route_logs")).toContain("user_id");
      expect(hasIndex(db!, "idx_route_logs_user")).toBe(true);
    } finally {
      db?.close();
    }
  });

  // -------------------------------------------------------------------------
  // Issue #505 part 2 — idx_route_logs_user matches getRouteLogs' actual
  // ORDER BY (started_at DESC, id DESC), not just (user_id, id DESC).
  // -------------------------------------------------------------------------

  it("issue #505: idx_route_logs_user is (user_id, started_at DESC, id DESC) and serves the sort with no temp b-tree", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    try {
      const idxSql = db!
        .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_route_logs_user'")
        .get() as { sql: string };
      expect(idxSql.sql).toBe(
        "CREATE INDEX idx_route_logs_user ON route_logs(user_id, started_at DESC, id DESC)"
      );

      const plan = db!
        .prepare(
          "EXPLAIN QUERY PLAN SELECT id FROM route_logs WHERE user_id = ? ORDER BY started_at DESC, id DESC LIMIT 10"
        )
        .all(1) as { detail: string }[];
      const detail = plan.map((r) => r.detail).join(" | ");
      expect(detail).toContain("idx_route_logs_user");
      expect(detail).not.toContain("TEMP B-TREE");
    } finally {
      db?.close();
    }
  });

  it("issue #505: a pre-existing (user_id, id DESC) index is replaced, not left alongside the new one", () => {
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
      CREATE TABLE route_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        route TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        status INTEGER NOT NULL,
        details TEXT,
        response_bytes INTEGER,
        render_ms INTEGER,
        user_id INTEGER REFERENCES users(id)
      );
      CREATE INDEX idx_route_logs_user ON route_logs(user_id, id DESC);
    `);
    raw.close();

    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    try {
      const rows = db!
        .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='route_logs' AND name='idx_route_logs_user'")
        .all() as { sql: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].sql).toBe(
        "CREATE INDEX idx_route_logs_user ON route_logs(user_id, started_at DESC, id DESC)"
      );
    } finally {
      db?.close();
    }
  });

  it("issue #499: lazy ALTER adds user_id to a legacy route_logs table without losing rows", () => {
    const file = newDbFile();
    // Mimic a prod DB that pre-dates issue #499: route_logs has the #296
    // perf columns but no user_id, and already has rows.
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE route_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        route TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        status INTEGER NOT NULL,
        details TEXT,
        response_bytes INTEGER,
        render_ms INTEGER
      );
      INSERT INTO route_logs (started_at, route, duration_ms, status, details)
      VALUES ('2026-05-13T12:00:00Z', '/recovery', 120, 200, '{"method":"GET"}');
    `);
    raw.close();

    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    try {
      expect(columns(db!, "route_logs")).toContain("user_id");
      const row = db!
        .prepare("SELECT route, status, user_id FROM route_logs WHERE id = 1")
        .get() as { route: string; status: number; user_id: number | null };
      expect(row.route).toBe("/recovery");
      expect(row.status).toBe(200);
      // Single-user DB (the fixture only ever inserts the bootstrap user
      // id=1) — the legacy row is claimed for that account, same policy as
      // chat_logs/sync_logs below.
      expect(row.user_id).toBe(1);
    } finally {
      db?.close();
    }
  });

  it("issue #499: multi-user DB leaves legacy route_logs rows NULL (fails closed)", () => {
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
      CREATE TABLE route_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        route TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        status INTEGER NOT NULL,
        details TEXT
      );
      INSERT INTO route_logs (started_at, route, duration_ms, status)
      VALUES ('2026-05-13T12:00:00Z', '/recovery', 120, 200);
    `);
    raw.close();

    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    try {
      const row = db!
        .prepare("SELECT user_id FROM route_logs WHERE id = 1")
        .get() as { user_id: number | null };
      expect(row.user_id).toBeNull();
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

  // REGRESSION for the "backfill is not one-time" defect. Post-migration,
  // NULL user_id is a DELIBERATE value — the webhook route writes it for
  // deliveries it cannot attribute, so they stay out of every tenant's /logs
  // and out of every tenant's sync-cooldown gate. A backfill gated only on
  // "exactly one user exists" runs on every openWrite() forever and adopts
  // those rows for the sole user, which would let a webhook for a stranger's
  // Whoop account suppress the real user's sync.
  it("issue #494: a NULL sync_logs row written AFTER migration is never claimed", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    // First open performs the migration on a single-user DB.
    conn.openWrite()?.close();

    // Simulate the webhook writing an unattributable delivery.
    const raw = new Database(file);
    raw
      .prepare(
        "INSERT INTO sync_logs (user_id, started_at, duration_ms, status, source) VALUES (NULL, ?, ?, 'ok', 'webhook')",
      )
      .run("2026-06-01T00:00:00Z", 10);
    raw.close();

    // Several more opens — each one used to re-run the claim.
    conn.openWrite()?.close();
    conn.openWrite()?.close();
    const db = conn.openWrite();
    try {
      const row = db!
        .prepare("SELECT user_id FROM sync_logs WHERE source = 'webhook'")
        .get() as { user_id: number | null };
      expect(row.user_id).toBeNull();
    } finally {
      db?.close();
    }
  });

  it("issue #494: post-migration NULL chat_logs rows survive repeated opens", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    conn.openWrite()?.close();

    const raw = new Database(file);
    raw
      .prepare(
        "INSERT INTO chat_logs (user_id, started_at, prompt_preview, duration_ms, status, response_length) VALUES (NULL, ?, ?, 1, 'ok', 1)",
      )
      .run("2026-06-01T00:00:00Z", "orphan");
    raw.close();

    conn.openWrite()?.close();
    const db = conn.openWrite();
    try {
      const row = db!
        .prepare("SELECT user_id FROM chat_logs WHERE prompt_preview = 'orphan'")
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

  // -------------------------------------------------------------------------
  // Issue #502 — USER_FK_TABLES has needed three manual edits (#494 adding
  // chat_logs/sync_logs, #499 adding route_logs) and each one was only caught
  // in review. The connection runs with foreign_keys = ON, so ANY table that
  // gains a `REFERENCES users(id)` FK and is missing from mergeUserInto's
  // repoint list makes the trailing `DELETE FROM users` throw — and
  // mergeUserInto sits on the Sign in with Apple path, so the symptom is a
  // 500 on sign-in for anyone whose merged-away account touched that table.
  //
  // A first version of this test only checked *membership in a list* — it
  // couldn't tell "the right list" from "any list", so:
  //   1. It reflected declared FKs only, missing workout_plans/server_logs
  //      (plain `user_id` column, no REFERENCES clause).
  //   2. Moving a PK/UNIQUE-constrained table (e.g. user_settings, whose
  //      user_id IS the primary key) into USER_FK_TABLES passed the test
  //      while mergeUserInto would then die with UNIQUE constraint failed.
  //   3. KNOWN_UNMERGED_USER_FK_TABLES membership was never actually
  //      verified against the invariant its own doc comment claimed.
  //
  // This version reflects the live schema on all three axes — column
  // presence (not just declared FKs), PK/UNIQUE-index membership (via
  // PRAGMA table_info/index_list/index_info), and ON DELETE actions (via
  // PRAGMA foreign_key_list) — so "just move it to the merge list" fails
  // loudly here instead of silently at the next split-brain merge or, worse,
  // silently passing review because the guard only checked *a* list.
  // -------------------------------------------------------------------------
  it("issue #502: every user_id-bearing table is in the correct one of USER_FK_TABLES / KNOWN_UNMERGED_USER_FK_TABLES", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    expect(db).not.toBeNull();
    try {
      const tables = (
        db!
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as { name: string }[]
      ).map((r) => r.name);

      const candidates = tablesWithUserIdOrFk(db!, tables);

      const userFkTables = new Set<string>(authMod.USER_FK_TABLES);
      const optional = new Set<string>(authMod.optionalUserFkTables(db!));
      const knownUnmerged = new Set<string>(authMod.KNOWN_UNMERGED_USER_FK_TABLES);
      const accountedFor = new Set<string>([...userFkTables, ...optional, ...knownUnmerged]);

      // Axis 1 — completeness: every table with a user_id column, or an FK to
      // users(id) under any name, must be accounted for in one of the three
      // lists. Enumerating by column presence (not declared-FK alone) is what
      // catches workout_plans and server_logs, which carry a plain `user_id`
      // column with no REFERENCES clause and were previously invisible here —
      // mergeUserInto silently orphaned their rows on every split-brain merge.
      const missing = [...candidates].filter((t) => !accountedFor.has(t));
      expect(
        missing,
        missing.length
          ? `table(s) have a user_id column (or an FK to users(id)) but are missing from ` +
              `USER_FK_TABLES / optionalUserFkTables / KNOWN_UNMERGED_USER_FK_TABLES in ` +
              `apps/web/src/lib/db/auth.ts: ${missing.join(", ")}`
          : "",
      ).toEqual([]);

      // The inverse drift: an entry that no longer has a user_id column (or
      // FK to users(id)) at all — dropped column, renamed table — should be
      // pruned rather than left to silently repoint an UPDATE against a
      // column that isn't there.
      const stale = [...accountedFor].filter(
        (t) => tables.includes(t) && !candidates.has(t),
      );
      expect(
        stale,
        `entries in USER_FK_TABLES / KNOWN_UNMERGED_USER_FK_TABLES that no longer have a ` +
          `user_id column or FK to users(id): ${stale.join(", ")}`,
      ).toEqual([]);

      // Axis 2 — positive safety: every USER_FK_TABLES member must actually
      // be safe for a bare `UPDATE ... SET user_id` repoint — user_id must
      // sit in NO PRIMARY KEY and NO UNIQUE index. This is the assertion that
      // catches "moving user_settings into USER_FK_TABLES passes review but
      // throws UNIQUE constraint failed at merge time" — the prose invariant
      // in USER_FK_TABLES's doc comment, turned into a check.
      const unsafeInMergeList = [...userFkTables].filter((t) =>
        userIdConstrainsUniqueness(db!, t),
      );
      expect(
        unsafeInMergeList,
        unsafeInMergeList.length
          ? `table(s) in USER_FK_TABLES have user_id in a PRIMARY KEY or UNIQUE index — a ` +
              `bare repoint would throw UNIQUE constraint failed whenever both merging ` +
              `accounts hold a matching row. Move to KNOWN_UNMERGED_USER_FK_TABLES (with a ` +
              `documented conflict policy) instead: ${unsafeInMergeList.join(", ")}`
          : "",
      ).toEqual([]);

      // Axis 3 — complement: every KNOWN_UNMERGED_USER_FK_TABLES member must
      // be excluded for a real, verified reason — user_id in a PRIMARY KEY or
      // UNIQUE index, OR a declared FK to users(id) with an ON DELETE action
      // (which silently cascades/detaches instead of failing loudly, its own
      // kind of unsafe — see the chat_attachments cascade-data-loss case
      // fixed in issue #502). A table satisfying neither has no reason to be
      // excluded from the merge list; it belongs in USER_FK_TABLES instead.
      const wronglyExcluded = [...knownUnmerged].filter(
        (t) => !userIdConstrainsUniqueness(db!, t) && !userIdFkHasOnDeleteAction(db!, t),
      );
      expect(
        wronglyExcluded,
        wronglyExcluded.length
          ? `table(s) in KNOWN_UNMERGED_USER_FK_TABLES have neither user_id in a PK/UNIQUE ` +
              `index nor an ON DELETE action on their FK to users(id) — nothing stops a bare ` +
              `repoint. Move to USER_FK_TABLES: ${wronglyExcluded.join(", ")}`
          : "",
      ).toEqual([]);
    } finally {
      db?.close();
    }
  });
});
