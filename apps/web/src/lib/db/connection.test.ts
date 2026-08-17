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

/**
 * Insert one row into `table` owned by `userId`, deriving the column list
 * from the live schema (issue #504). Every NOT NULL column without a default
 * gets a type-appropriate value, plus any non-INTEGER PRIMARY KEY (workouts
 * and chat_attachments key on a TEXT id).
 *
 * Reflected rather than hand-written so the behavioural merge test seeds a
 * table that is added later without anyone remembering to extend a fixture —
 * an unseeded table would make "nothing was lost" vacuously true for it.
 *
 * NOT NULL foreign keys to tables other than `users` are resolved to a real
 * parent row (seeding the parent first if need be), so the seed itself runs
 * clean under foreign_keys = ON.
 */
let seedCounter = 0;
function seedUserRow(
  db: Database.Database,
  table: string,
  userId: number,
  tag: string,
  depth = 0,
): void {
  if (depth > 4) throw new Error(`seedUserRow: FK chain too deep at ${table}`);
  const info = db.prepare(`PRAGMA table_info("${table}")`).all() as {
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
  }[];
  const fks = db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as {
    from: string;
    table: string;
    to: string;
  }[];

  const values: Record<string, unknown> = { user_id: userId };
  for (const col of info) {
    if (col.name === "user_id") continue;
    const required = col.notnull === 1 && col.dflt_value === null;
    const textPk = col.pk > 0 && !/INT/i.test(col.type);
    if (!required && !textPk) continue;

    const fk = fks.find((f) => f.from === col.name && f.table !== "users");
    if (fk) {
      const parentCol = fk.to || "rowid";
      let parent = db
        .prepare(`SELECT "${parentCol}" AS v FROM "${fk.table}" LIMIT 1`)
        .get() as { v: unknown } | undefined;
      if (!parent) {
        seedUserRow(db, fk.table, userId, `${tag}-p`, depth + 1);
        parent = db
          .prepare(`SELECT "${parentCol}" AS v FROM "${fk.table}" LIMIT 1`)
          .get() as { v: unknown } | undefined;
      }
      values[col.name] = parent!.v;
      continue;
    }

    const unique = `${tag}-${col.name}-${++seedCounter}`;
    const type = col.type.toUpperCase();
    if (type.includes("INT")) values[col.name] = seedCounter;
    else if (/REAL|FLOA|DOUB/.test(type)) values[col.name] = seedCounter + 0.5;
    else if (type.includes("BLOB")) values[col.name] = Buffer.from(unique);
    else values[col.name] = unique;
  }

  const cols = Object.keys(values);
  db.prepare(
    `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) ` +
      `VALUES (${cols.map(() => "?").join(", ")})`,
  ).run(...cols.map((c) => values[c]));
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

  // -------------------------------------------------------------------------
  // Blocking perf regression fix (post-#505 review) — migrateRouteLogsSchema
  // used to DROP+CREATE idx_route_logs_user unconditionally on every call,
  // meaning every openWrite() after the first paid a full route_logs table
  // scan to rebuild an index that hadn't changed. The fix gates the rebuild
  // on the index's current stored definition (see ROUTE_LOGS_INDEX_DEFINITION
  // in connection.ts). This test proves the no-op path actually no-ops.
  //
  // Deliberately NOT asserting on sqlite_master.rootpage as the signal:
  // verified empirically that DROP INDEX immediately followed by CREATE
  // INDEX with no other page allocation in between (which is exactly what
  // the buggy unconditional code does — the two statements are adjacent)
  // gets the SAME freed page handed straight back by SQLite, so rootpage
  // stays identical whether or not the rebuild fires. A rootpage-based
  // assertion here would pass even with the bug reintroduced — a brittle
  // check that looks like coverage but isn't. Spying on the exec() calls
  // that would perform the DROP/CREATE is the reliable, deterministic
  // signal: confirmed this test fails when the gate is removed (unconditional
  // DROP+CREATE reintroduced) and passes with the gate in place.
  it("issue #505 perf fix: a second migrateRouteLogsSchema() call does not DROP or CREATE idx_route_logs_user again", () => {
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
    `);
    try {
      // First call: route_logs doesn't exist yet, so this bootstraps the
      // table, adds user_id, and creates idx_route_logs_user from scratch.
      conn.migrateRouteLogsSchema(raw);

      const execSpy = vi.spyOn(raw, "exec");
      // Second call: everything — including the index — is already current.
      conn.migrateRouteLogsSchema(raw);

      const indexStatements = execSpy.mock.calls
        .map(([sql]) => sql)
        .filter((sql): sql is string => typeof sql === "string" && sql.includes("idx_route_logs_user"));
      expect(indexStatements).toEqual([]);

      execSpy.mockRestore();
    } finally {
      raw.close();
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
  //
  // Issue #504 — and why even THAT was not enough. Every axis above is
  // bookkeeping: it asks "is this table named in one of the lists, and is the
  // list it is named in consistent with the schema". It never asks whether a
  // merge works. So all seven tables that made mergeUserInto throw
  // `FOREIGN KEY constraint failed` (recovery, cycles, sleep, daily_summary,
  // integrations, user_settings, device_tokens) sat in
  // KNOWN_UNMERGED_USER_FK_TABLES and passed this test cleanly while Sign in
  // with Apple was 500ing in production. Membership in the "deliberately not
  // merged" list was accepted as equivalent to being merged; it is the
  // opposite. A table left out of the repoint still points at the losing
  // account when `DELETE FROM users` runs.
  //
  // The fix is a fourth, behavioural axis (the test after this one): build a
  // real DB, give the LOSER a row in every user_id-bearing table enumerated
  // from the live schema, run a real merge, and assert it neither throws nor
  // loses rows. That axis fails on the pre-#504 code and cannot be satisfied
  // by editing a list.
  // -------------------------------------------------------------------------
  it("issue #502/#504: every user_id-bearing table is in the correct one of USER_FK_TABLES / USER_FK_CONFLICT_TABLES", () => {
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
      const conflictTables = new Set<string>(authMod.USER_FK_CONFLICT_TABLES);
      const knownUnmerged = new Set<string>(authMod.KNOWN_UNMERGED_USER_FK_TABLES);
      const accountedFor = new Set<string>([
        ...userFkTables,
        ...optional,
        ...conflictTables,
        ...knownUnmerged,
      ]);

      // Axis 1 — completeness: every table with a user_id column, or an FK to
      // users(id) under any name, must be accounted for in one of the lists.
      // Enumerating by column presence (not declared-FK alone) is what
      // catches workout_plans and server_logs, which carry a plain `user_id`
      // column with no REFERENCES clause and were previously invisible here —
      // mergeUserInto silently orphaned their rows on every split-brain merge.
      const missing = [...candidates].filter((t) => !accountedFor.has(t));
      expect(
        missing,
        missing.length
          ? `table(s) have a user_id column (or an FK to users(id)) but are missing from ` +
              `USER_FK_TABLES / optionalUserFkTables / USER_FK_CONFLICT_TABLES / ` +
              `KNOWN_UNMERGED_USER_FK_TABLES in apps/web/src/lib/db/auth.ts: ${missing.join(", ")}`
          : "",
      ).toEqual([]);

      // Axis 1b — the lists must be disjoint. A table in both USER_FK_TABLES
      // and USER_FK_CONFLICT_TABLES would be repointed twice by mergeUserInto:
      // the bare UPDATE runs first and throws on the very collision the
      // conflict path exists to resolve, so "belt and braces" here is a bug.
      const doubleListed = [...candidates].filter(
        (t) =>
          [userFkTables, optional, conflictTables, knownUnmerged].filter((s) =>
            s.has(t),
          ).length > 1,
      );
      expect(
        doubleListed,
        `table(s) appear in more than one of the auth.ts merge lists — each needs exactly ` +
          `one merge strategy: ${doubleListed.join(", ")}`,
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
        `entries in the auth.ts merge lists that no longer have a ` +
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
              `accounts hold a matching row. Move to USER_FK_CONFLICT_TABLES (survivor-wins) ` +
              `instead: ${unsafeInMergeList.join(", ")}`
          : "",
      ).toEqual([]);

      // Axis 3 — complement: USER_FK_CONFLICT_TABLES pays for a delete pass
      // per uniqueness key on every merge, so a table only belongs there if
      // user_id really is in a PRIMARY KEY or UNIQUE index. Anything else is
      // safe (and cheaper) as a bare repoint in USER_FK_TABLES.
      const cheapEnoughForBareRepoint = [...conflictTables].filter(
        (t) => !userIdConstrainsUniqueness(db!, t),
      );
      expect(
        cheapEnoughForBareRepoint,
        cheapEnoughForBareRepoint.length
          ? `table(s) in USER_FK_CONFLICT_TABLES have user_id in no PRIMARY KEY and no ` +
              `UNIQUE index, so nothing can collide and the survivor-wins delete pass can ` +
              `only lose rows for no reason. Move to USER_FK_TABLES: ` +
              `${cheapEnoughForBareRepoint.join(", ")}`
          : "",
      ).toEqual([]);

      // Axis 3b — the escape hatch stays shut. Anything in
      // KNOWN_UNMERGED_USER_FK_TABLES is genuinely not merged, so it still
      // points at the losing account when `DELETE FROM users` runs: the merge
      // throws FOREIGN KEY constraint failed (issue #504's sign-in 500) or,
      // with ON DELETE CASCADE, silently destroys the rows (issue #504's
      // chat_attachments case). There is no schema property that makes that
      // acceptable, which is why this is an emptiness check and not another
      // "is the exclusion justified" check — the previous formulation of that
      // check is precisely what rubber-stamped all seven #504 tables.
      expect(
        [...knownUnmerged],
        `KNOWN_UNMERGED_USER_FK_TABLES must stay empty: a listed table still points at the ` +
          `losing user when mergeUserInto runs DELETE FROM users, which throws (or cascades ` +
          `the rows away). Give it a merge strategy in USER_FK_TABLES or ` +
          `USER_FK_CONFLICT_TABLES instead`,
      ).toEqual([]);

      // Sanity-check the ON DELETE reflection helper still has a subject —
      // chat_attachments is the schema's only cascading user_id FK and the
      // reason a missing table can fail silently rather than loudly. If this
      // ever goes false the helper has gone blind, not the risk away.
      expect(
        userIdFkHasOnDeleteAction(db!, "chat_attachments"),
        "chat_attachments.user_id should still declare ON DELETE CASCADE",
      ).toBe(true);
    } finally {
      db?.close();
    }
  });

  // -------------------------------------------------------------------------
  // Issue #504 — the behavioural axis. Everything above is list bookkeeping;
  // this runs an actual split-brain merge through the real code path
  // (upsertUserByAppleSub → mergeUserInto) against a real openWrite() schema
  // with foreign_keys = ON.
  //
  // Table set and required columns are reflected from the live schema, not
  // hardcoded, so a table added later without a merge strategy fails here on
  // its first run instead of on someone's next sign-in.
  // -------------------------------------------------------------------------
  it("issue #504: a real merge succeeds and loses nothing when the loser holds a row in every user_id table", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    let boot = conn.openWrite();
    expect(boot).not.toBeNull();
    const tables = (
      boot!
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[]
    ).map((r) => r.name);
    const candidates = [...tablesWithUserIdOrFk(boot!, tables)];
    boot!.close();
    boot = null;

    // Split-brain state: `keep` matched by apple_sub (holds the OLD email),
    // `gone` matched by the NEW email the user now signs in with.
    const seed = new Database(file);
    let goneId: number;
    try {
      seed.pragma("foreign_keys = ON");
      seed
        .prepare("UPDATE users SET apple_sub = ?, email = ? WHERE id = 1")
        .run("sub-504-keep", "old-504@example.com");
      goneId = Number(
        seed
          .prepare("INSERT INTO users (apple_sub, email) VALUES (?, ?)")
          .run("sub-504-gone", "new-504@example.com").lastInsertRowid,
      );
      for (const table of candidates) {
        seedUserRow(seed, table, goneId, `l-${table}`);
      }
    } finally {
      seed.close();
    }

    const before = new Database(file);
    const rowsBefore = new Map<string, number>();
    try {
      for (const table of candidates) {
        const n = before
          .prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE user_id = ?`)
          .get(goneId) as { n: number };
        // The seeder has to actually have seeded, or "nothing was lost" is
        // vacuously true for that table.
        expect(n.n, `${table} was not seeded for the losing user`).toBeGreaterThan(0);
        rowsBefore.set(table, n.n);
      }
    } finally {
      before.close();
    }

    // Pre-#504 this threw `FOREIGN KEY constraint failed` on the first of the
    // seven conflict tables (and, for chat_attachments, silently cascaded).
    const keep = authMod.upsertUserByAppleSub("sub-504-keep", "new-504@example.com");
    expect(keep.id).toBe(1);

    const after = new Database(file);
    try {
      const users = after.prepare("SELECT id FROM users").all() as { id: number }[];
      expect(users.map((u) => u.id)).toEqual([1]);

      for (const table of candidates) {
        const dangling = after
          .prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE user_id = ?`)
          .get(goneId) as { n: number };
        expect(dangling.n, `${table} still points at the deleted user`).toBe(0);

        // Survivor held no rows, so every loser row must have MOVED — none
        // dropped by the survivor-wins policy, none cascaded away.
        const moved = after
          .prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE user_id = ?`)
          .get(keep.id) as { n: number };
        expect(moved.n, `${table} lost rows during the merge`).toBe(
          rowsBefore.get(table),
        );
      }

      // Belt and braces on the FK invariant itself.
      const violations = after.pragma("foreign_key_check") as unknown[];
      expect(violations).toEqual([]);
    } finally {
      after.close();
    }
  });

  // -------------------------------------------------------------------------
  // Issue #504 — the collision path. Both accounts hold a row on the same
  // uniqueness key, so the repoint cannot just move it. Policy: SURVIVOR
  // WINS, and the drop is counted in the merge log line.
  // -------------------------------------------------------------------------
  it("issue #504: survivor's row wins a collision, the loser's is dropped and counted in the log", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    const boot = conn.openWrite();
    boot?.close();

    const seed = new Database(file);
    let goneId: number;
    try {
      seed.pragma("foreign_keys = ON");
      seed
        .prepare("UPDATE users SET apple_sub = ?, email = ? WHERE id = 1")
        .run("sub-504-conflict-keep", "old-conflict@example.com");
      goneId = Number(
        seed
          .prepare("INSERT INTO users (apple_sub, email) VALUES (?, ?)")
          .run("sub-504-conflict-gone", "new-conflict@example.com").lastInsertRowid,
      );
      // Same PK (user_id, date) → collision. Distinct scores so we can tell
      // which row survived.
      for (const userId of [1, goneId]) {
        seed
          .prepare("INSERT INTO recovery (user_id, date, recovery_score) VALUES (?, ?, ?)")
          .run(userId, "2026-05-01", userId === 1 ? 88 : 11);
      }
      // Non-colliding date on the loser — must still be moved, not dropped.
      seed
        .prepare("INSERT INTO recovery (user_id, date, recovery_score) VALUES (?, ?, ?)")
        .run(goneId, "2026-05-02", 42);
      // Same (user_id, provider) → collision on a different key shape.
      for (const userId of [1, goneId]) {
        seed
          .prepare(
            `INSERT INTO integrations (user_id, provider, access_token, refresh_token, expires_at, updated_at)
             VALUES (?, 'whoop', ?, 'r', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z')`,
          )
          .run(userId, userId === 1 ? "survivor-token" : "loser-token");
      }
      // user_settings keys on user_id ALONE — any row on both sides collides.
      for (const userId of [1, goneId]) {
        seed
          .prepare(
            "INSERT INTO user_settings (user_id, model_pref, updated_at) VALUES (?, ?, '2026-05-01T00:00:00Z')",
          )
          .run(userId, userId === 1 ? "survivor-pref" : "loser-pref");
      }
      // sleep keys on (user_id, sleep_id), NOT (user_id, date) — same date,
      // different sleep_id, so both rows must survive the merge.
      seed
        .prepare("INSERT INTO sleep (user_id, sleep_id, date) VALUES (?, ?, ?)")
        .run(1, "sleep-main", "2026-05-01");
      seed
        .prepare("INSERT INTO sleep (user_id, sleep_id, date) VALUES (?, ?, ?)")
        .run(goneId, "sleep-nap", "2026-05-01");
    } finally {
      seed.close();
    }

    const logged: string[] = [];
    const capture = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(capture);
    const logSpy = vi.spyOn(console, "log").mockImplementation(capture);
    try {
      const keep = authMod.upsertUserByAppleSub(
        "sub-504-conflict-keep",
        "new-conflict@example.com",
      );
      expect(keep.id).toBe(1);
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }

    const after = new Database(file);
    try {
      // Survivor's data is untouched; the loser's colliding rows are gone.
      const rec = after
        .prepare("SELECT date, recovery_score FROM recovery WHERE user_id = 1 ORDER BY date")
        .all() as { date: string; recovery_score: number }[];
      expect(rec).toEqual([
        { date: "2026-05-01", recovery_score: 88 },
        { date: "2026-05-02", recovery_score: 42 },
      ]);

      const integ = after
        .prepare("SELECT access_token FROM integrations WHERE user_id = 1")
        .all() as { access_token: string }[];
      expect(integ).toEqual([{ access_token: "survivor-token" }]);

      const settings = after
        .prepare("SELECT model_pref FROM user_settings")
        .all() as { model_pref: string }[];
      expect(settings).toEqual([{ model_pref: "survivor-pref" }]);

      // (user_id, sleep_id) — a shared date is NOT a collision here.
      const sleeps = after
        .prepare("SELECT sleep_id FROM sleep WHERE user_id = 1 ORDER BY sleep_id")
        .all() as { sleep_id: string }[];
      expect(sleeps).toEqual([{ sleep_id: "sleep-main" }, { sleep_id: "sleep-nap" }]);

      expect((after.prepare("SELECT id FROM users").all() as unknown[]).length).toBe(1);
    } finally {
      after.close();
    }

    // The drop is counted, per table, in the merge log line — and visibly
    // separated from the move counts. A silent drop is the failure mode #504
    // is about, so this assertion is load-bearing, not cosmetic.
    const mergeLine = logged.find((l) => l.includes("[upsertUserByAppleSub] merged user"));
    expect(mergeLine, `no merge log line in: ${logged.join(" | ")}`).toBeDefined();
    expect(mergeLine).toContain("dropped(survivor-wins, total=3)");
    expect(mergeLine).toMatch(/dropped\(survivor-wins, total=3\):[^;]*\brecovery=1\b/);
    expect(mergeLine).toMatch(/dropped\(survivor-wins, total=3\):[^;]*\bintegrations=1\b/);
    expect(mergeLine).toMatch(/dropped\(survivor-wins, total=3\):[^;]*\buser_settings=1\b/);
    // Moves are still reported, and the non-colliding rows are among them.
    expect(mergeLine).toMatch(/moved:[^;]*\brecovery=1\b/);
    expect(mergeLine).toMatch(/moved:[^;]*\bsleep=1\b/);
  });

  // The collision keys mergeUserInto derives must match the primary keys
  // documented in CLAUDE.md's DB layer table. Assuming `(user_id, date)`
  // everywhere is wrong and has broken this repo's suite before.
  it("issue #504: collision keys are reflected per table, not assumed uniform", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    try {
      const keyOf = (t: string) =>
        authMod.userIdUniqueKeys(db!, t).map((k) => [...k].sort().join(","));
      expect(keyOf("recovery")).toEqual(["date,user_id"]);
      expect(keyOf("cycles")).toEqual(["date,user_id"]);
      expect(keyOf("daily_summary")).toEqual(["date,user_id"]);
      expect(keyOf("sleep")).toEqual(["sleep_id,user_id"]);
      expect(keyOf("integrations")).toEqual(["provider,user_id"]);
      expect(keyOf("user_settings")).toEqual(["user_id"]);
      expect(keyOf("device_tokens")).toEqual(["token,user_id"]);
      // Surrogate-keyed tables have no user_id-bearing uniqueness constraint
      // at all — which is exactly why they get the cheap bare repoint.
      for (const t of ["workouts", "chat_attachments", "client_logs", "perf_metrics"]) {
        expect(keyOf(t), `${t} should have no user_id uniqueness key`).toEqual([]);
      }
    } finally {
      db?.close();
    }
  });

  // -------------------------------------------------------------------------
  // Issue #518 — `journal` is externally populated and absent from every
  // openWrite() schema, so it was never enumerated by userIdUniqueKeys() or
  // by the reflection guard above, and mergeUserInto repointed it with the
  // bare USER_FK_TABLES UPDATE unconditionally. A live journal table with a
  // unique index touching user_id (`UNIQUE(user_id, date)` is the natural
  // shape for a daily journal) would throw UNIQUE constraint failed there —
  // the same failure class #504 fixed for every table this app's schema
  // controls, reintroduced through the one table it doesn't.
  //
  // These four tests seed `journal` by hand, the way an external producer
  // would, exactly like journal.test.ts and the #494 tests above already do.
  // -------------------------------------------------------------------------

  it("issue #518: journal with a UNIQUE(user_id, date) index merges survivor-wins, with the drop logged", () => {
    const file = newDbFile();
    // Seed journal BEFORE the first openWrite() so the lazy ALTER path
    // (connection.ts's `if (hasTable(db, "journal"))` block) also exercises
    // against it — the table pre-exists exactly like a real external
    // producer's table would.
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE journal (
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        title TEXT,
        content TEXT,
        mood TEXT,
        tags TEXT,
        UNIQUE (user_id, date)
      );
    `);
    raw.close();
    process.env.WHOOP_DB_PATH = file;

    // First open runs the schema bootstrap (users table, etc.) and the lazy
    // journal ALTER (idx_journal_user_date) without touching the UNIQUE
    // index above — user_id already exists on this table.
    conn.openWrite()?.close();

    const seed = new Database(file);
    let goneId: number;
    try {
      seed.pragma("foreign_keys = ON");
      seed
        .prepare("UPDATE users SET apple_sub = ?, email = ? WHERE id = 1")
        .run("sub-518-keep", "old-518@example.com");
      goneId = Number(
        seed
          .prepare("INSERT INTO users (apple_sub, email) VALUES (?, ?)")
          .run("sub-518-gone", "new-518@example.com").lastInsertRowid,
      );
      // Colliding row: both users journaled on the same date.
      seed
        .prepare(
          "INSERT INTO journal (user_id, date, title) VALUES (?, '2026-06-01', 'survivor entry')",
        )
        .run(1);
      seed
        .prepare(
          "INSERT INTO journal (user_id, date, title) VALUES (?, '2026-06-01', 'loser entry — should be dropped')",
        )
        .run(goneId);
      // Non-colliding row on the loser — must still move, not drop.
      seed
        .prepare(
          "INSERT INTO journal (user_id, date, title) VALUES (?, '2026-06-02', 'loser entry — should move')",
        )
        .run(goneId);
    } finally {
      seed.close();
    }

    const logged: string[] = [];
    const capture = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(capture);
    const logSpy = vi.spyOn(console, "log").mockImplementation(capture);
    let keep: { id: number };
    try {
      // Pre-#518 fix, this throws UNIQUE constraint failed on the collision
      // row instead of merging.
      keep = authMod.upsertUserByAppleSub("sub-518-keep", "new-518@example.com");
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
    expect(keep.id).toBe(1);

    const after = new Database(file);
    try {
      const rows = after
        .prepare("SELECT user_id, date, title FROM journal ORDER BY date")
        .all() as { user_id: number; date: string; title: string }[];
      expect(rows).toEqual([
        { user_id: 1, date: "2026-06-01", title: "survivor entry" },
        { user_id: 1, date: "2026-06-02", title: "loser entry — should move" },
      ]);
      expect((after.prepare("SELECT id FROM users").all() as unknown[]).length).toBe(1);
      const violations = after.pragma("foreign_key_check") as unknown[];
      expect(violations).toEqual([]);
    } finally {
      after.close();
    }

    const mergeLine = logged.find((l) => l.includes("[upsertUserByAppleSub] merged user"));
    expect(mergeLine, `no merge log line in: ${logged.join(" | ")}`).toBeDefined();
    expect(mergeLine).toMatch(/dropped\(survivor-wins, total=1\):[^;]*\bjournal=1\b/);
    expect(mergeLine).toMatch(/moved:[^;]*\bjournal=1\b/);
  });

  it("issue #518: merge still succeeds cleanly when journal is absent entirely (pre-existing behavior, unregressed)", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    conn.openWrite()?.close();

    const seed = new Database(file);
    let goneId: number;
    try {
      seed.pragma("foreign_keys = ON");
      seed
        .prepare("UPDATE users SET apple_sub = ?, email = ? WHERE id = 1")
        .run("sub-518-noj-keep", "old-518-noj@example.com");
      goneId = Number(
        seed
          .prepare("INSERT INTO users (apple_sub, email) VALUES (?, ?)")
          .run("sub-518-noj-gone", "new-518-noj@example.com").lastInsertRowid,
      );
    } finally {
      seed.close();
    }
    expect(goneId).toBeGreaterThan(1);

    const keep = authMod.upsertUserByAppleSub("sub-518-noj-keep", "new-518-noj@example.com");
    expect(keep.id).toBe(1);

    const after = new Database(file);
    try {
      expect(
        (
          after
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='journal'")
            .get()
        ),
      ).toBeUndefined();
      expect((after.prepare("SELECT id FROM users").all() as unknown[]).length).toBe(1);
    } finally {
      after.close();
    }
  });

  it("issue #518: journal with no uniqueness on user_id takes the bare-repoint path and moves every row", () => {
    const file = newDbFile();
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        title TEXT
      );
    `);
    raw.close();
    process.env.WHOOP_DB_PATH = file;
    conn.openWrite()?.close();

    // Routing assertion. This is what discriminates the path — the row
    // outcome below cannot: with no uniqueness key, mergeConflictTable's key
    // loop is empty, so it deletes nothing and its trailing UPDATE moves the
    // same rows the bare repoint does. Both paths produce identical rows and
    // identical log counts for this shape, so the merge assertions that follow
    // cover the OUTCOME only; routing is asserted here and, schema-driven,
    // in the test after this one.
    const check = conn.openWrite();
    try {
      expect(authMod.userIdUniqueKeys(check!, "journal")).toEqual([]);
      const routed = authMod.partitionOptionalMergeTables(check!, ["journal"]);
      expect(routed).toEqual({ bare: ["journal"], conflict: [] });
    } finally {
      check?.close();
    }

    const seed = new Database(file);
    let goneId: number;
    try {
      seed.pragma("foreign_keys = ON");
      seed
        .prepare("UPDATE users SET apple_sub = ?, email = ? WHERE id = 1")
        .run("sub-518-bare-keep", "old-518-bare@example.com");
      goneId = Number(
        seed
          .prepare("INSERT INTO users (apple_sub, email) VALUES (?, ?)")
          .run("sub-518-bare-gone", "new-518-bare@example.com").lastInsertRowid,
      );
      // Survivor and loser both journal on the SAME date. With no uniqueness
      // constraint this is legal, so every row must survive the merge and end
      // up owned by the survivor.
      seed
        .prepare("INSERT INTO journal (user_id, date, title) VALUES (1, '2026-06-01', 'survivor')")
        .run();
      seed
        .prepare(
          "INSERT INTO journal (user_id, date, title) VALUES (?, '2026-06-01', 'loser same date')",
        )
        .run(goneId);
      seed
        .prepare(
          "INSERT INTO journal (user_id, date, title) VALUES (?, '2026-06-02', 'loser other date')",
        )
        .run(goneId);
    } finally {
      seed.close();
    }

    const logged: string[] = [];
    const logSpy = vi
      .spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
    let keep: { id: number };
    try {
      keep = authMod.upsertUserByAppleSub("sub-518-bare-keep", "new-518-bare@example.com");
    } finally {
      logSpy.mockRestore();
    }
    expect(keep.id).toBe(1);

    const after = new Database(file);
    try {
      const rows = after
        .prepare("SELECT user_id, date, title FROM journal ORDER BY id")
        .all() as { user_id: number; date: string; title: string }[];
      // All three rows survive — nothing dropped — and all point at the
      // survivor now.
      expect(rows).toEqual([
        { user_id: 1, date: "2026-06-01", title: "survivor" },
        { user_id: 1, date: "2026-06-01", title: "loser same date" },
        { user_id: 1, date: "2026-06-02", title: "loser other date" },
      ]);
      expect((after.prepare("SELECT id FROM users").all() as unknown[]).length).toBe(1);
    } finally {
      after.close();
    }

    const mergeLine = logged.find((l) => l.includes("[upsertUserByAppleSub] merged user"));
    expect(mergeLine, `no merge log line in: ${logged.join(" | ")}`).toBeDefined();
    // No drops at all — dropped total is 0 — and the bare path reports both
    // loser rows moved.
    expect(mergeLine).toContain("dropped(survivor-wins, total=0): none");
    expect(mergeLine).toMatch(/moved:[^;]*\bjournal=2\b/);
  });

  // Issue #518 — THE routing guard. The bucket a table lands in must be
  // derived from its schema, not from the literal string "journal", so this
  // asserts partitionOptionalMergeTables directly (row-level merge outcomes
  // can't tell the two paths apart when the table has no uniqueness key).
  // `future_widget_notes` is not a table this repo plans to add; it is a
  // second, differently-shaped input that journal's name can't explain, which
  // is the only way to show the decision is schema-derived.
  it("issue #518: the bare-vs-conflict split is schema-driven, not name-hardcoded — proven with a non-journal table", () => {
    const file = newDbFile();
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE journal (
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        UNIQUE (user_id, date)
      );
      CREATE TABLE future_widget_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        note TEXT
      );
    `);
    raw.close();
    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    try {
      const { bare, conflict } = authMod.partitionOptionalMergeTables(db!, [
        "journal",
        "future_widget_notes",
      ]);
      // journal has a UNIQUE(user_id, date) index → conflict path, carrying
      // the derived collision key the merge will actually use.
      expect(conflict).toEqual([{ table: "journal", keys: [["user_id", "date"]] }]);
      // future_widget_notes has a user_id column but no PK/UNIQUE touching it
      // → bare-repoint path. Nothing in partitionOptionalMergeTables mentions
      // either table's name — the split comes entirely from reflecting the
      // schema at call time.
      expect(bare).toEqual(["future_widget_notes"]);
    } finally {
      db?.close();
    }
  });

  // -------------------------------------------------------------------------
  // PR #520 review — two regressions the first cut of the optional-table
  // routing introduced, both against shapes `journal` is entitled to have
  // because this app does not own its schema:
  //
  //   1. userIdUniqueKeys THROWS on a partial unique index covering user_id.
  //      That guarantee is right for the seven tables this repo owns (a
  //      partial index there is a bug to fix), but routing `journal` through
  //      it made an ordinary soft-delete index 500 every split-brain sign-in
  //      even with the table EMPTY — strictly worse than the bare repoint
  //      that ran before #520.
  //   2. The conflict path DELETEs losing rows. That cascades nowhere for the
  //      seven owned tables, but a child table with ON DELETE CASCADE on an
  //      unknown-schema table would have its rows destroyed silently — #504's
  //      exact chat_attachments symptom, reintroduced.
  //
  // The rule both tests encode: routing an optional table may never be worse
  // than the bare repoint, and a loud in-transaction throw is acceptable
  // where silent data loss is not.
  // -------------------------------------------------------------------------

  /** Point users id=1 at `keepSub` and add a second user; returns its id. */
  function seedSplitBrainUsers(file: string, keepSub: string, goneSub: string): number {
    const seed = new Database(file);
    try {
      seed.pragma("foreign_keys = ON");
      seed
        .prepare("UPDATE users SET apple_sub = ?, email = ? WHERE id = 1")
        .run(keepSub, `old-${keepSub}@example.com`);
      return Number(
        seed
          .prepare("INSERT INTO users (apple_sub, email) VALUES (?, ?)")
          .run(goneSub, `new-${keepSub}@example.com`).lastInsertRowid,
      );
    } finally {
      seed.close();
    }
  }

  /** Run a merge with console.log/warn captured. */
  function mergeCapturingLogs(keepSub: string, email: string): {
    result: { id: number } | null;
    error: unknown;
    logged: string[];
  } {
    const logged: string[] = [];
    const capture = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(capture);
    const logSpy = vi.spyOn(console, "log").mockImplementation(capture);
    try {
      return { result: authMod.upsertUserByAppleSub(keepSub, email), error: null, logged };
    } catch (err) {
      return { result: null, error: err, logged };
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  }

  it("PR #520 review: an EMPTY journal with a partial unique index on user_id still merges — a soft-delete index must not 500 sign-in", () => {
    const file = newDbFile();
    const raw = new Database(file);
    // The reproduction from the review: an ordinary soft-delete shape.
    raw.exec(`
      CREATE TABLE journal (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        date TEXT,
        deleted INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX journal_live_uq ON journal(user_id, date) WHERE deleted = 0;
    `);
    raw.close();
    process.env.WHOOP_DB_PATH = file;
    conn.openWrite()?.close();

    const goneId = seedSplitBrainUsers(file, "sub-520-partial-empty-keep", "sub-520-partial-empty-gone");
    expect(goneId).toBeGreaterThan(1);

    const { result, error, logged } = mergeCapturingLogs(
      "sub-520-partial-empty-keep",
      "new-sub-520-partial-empty-keep@example.com",
    );
    expect(error, `merge threw: ${String(error)}`).toBeNull();
    expect(result?.id).toBe(1);

    const after = new Database(file);
    try {
      expect((after.prepare("SELECT id FROM users").all() as unknown[]).length).toBe(1);
    } finally {
      after.close();
    }

    // The partial index is skipped, and says so — silence here would be the
    // review's other complaint (an unexplained routing decision).
    const warned = logged.find((l) => l.includes("journal_live_uq"));
    expect(warned, `no partial-index warning in: ${logged.join(" | ")}`).toBeDefined();
    expect(warned).toContain("PARTIAL");
  });

  it("PR #520 review: a partial-index-only collision fails loudly and loses nothing — never a silent drop", () => {
    const file = newDbFile();
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE journal (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        date TEXT,
        deleted INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX journal_live_uq ON journal(user_id, date) WHERE deleted = 0;
    `);
    raw.close();
    process.env.WHOOP_DB_PATH = file;
    conn.openWrite()?.close();

    const goneId = seedSplitBrainUsers(file, "sub-520-partial-rows-keep", "sub-520-partial-rows-gone");
    const seed = new Database(file);
    try {
      seed
        .prepare("INSERT INTO journal (id, user_id, date, deleted) VALUES (1, 1, '2026-06-01', 0)")
        .run();
      // Live row on the loser for the same date — collides once repointed.
      seed
        .prepare("INSERT INTO journal (id, user_id, date, deleted) VALUES (2, ?, '2026-06-01', 0)")
        .run(goneId);
      seed
        .prepare("INSERT INTO journal (id, user_id, date, deleted) VALUES (3, ?, '2026-06-02', 0)")
        .run(goneId);
    } finally {
      seed.close();
    }

    const { error } = mergeCapturingLogs(
      "sub-520-partial-rows-keep",
      "new-sub-520-partial-rows-keep@example.com",
    );
    // Chosen behaviour: the partial index is not a usable collision key, so
    // the table takes the bare repoint and SQLite rejects it. Loud and
    // retryable — identical to the behaviour before #520 — where guessing at
    // the predicate would have deleted the loser's row.
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/UNIQUE constraint failed/);

    const after = new Database(file);
    try {
      // The merge transaction rolled back: nothing dropped, nothing moved,
      // both accounts still present for a retry.
      expect(
        after.prepare("SELECT id, user_id FROM journal ORDER BY id").all(),
      ).toEqual([
        { id: 1, user_id: 1 },
        { id: 2, user_id: goneId },
        { id: 3, user_id: goneId },
      ]);
      expect((after.prepare("SELECT id FROM users").all() as unknown[]).length).toBe(2);
    } finally {
      after.close();
    }
  });

  it("PR #520 review: a partial index does not disable the TOTAL unique key next to it", () => {
    const file = newDbFile();
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE journal (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        date TEXT,
        deleted INTEGER NOT NULL DEFAULT 0,
        UNIQUE (user_id, date)
      );
      CREATE UNIQUE INDEX journal_live_uq ON journal(user_id, date) WHERE deleted = 0;
    `);
    raw.close();
    process.env.WHOOP_DB_PATH = file;
    conn.openWrite()?.close();

    const goneId = seedSplitBrainUsers(file, "sub-520-partial-mixed-keep", "sub-520-partial-mixed-gone");
    const seed = new Database(file);
    try {
      seed
        .prepare("INSERT INTO journal (id, user_id, date) VALUES (1, 1, '2026-06-01')")
        .run();
      seed.prepare("INSERT INTO journal (id, user_id, date) VALUES (2, ?, '2026-06-01')").run(goneId);
      seed.prepare("INSERT INTO journal (id, user_id, date) VALUES (3, ?, '2026-06-02')").run(goneId);
    } finally {
      seed.close();
    }

    const { result, error, logged } = mergeCapturingLogs(
      "sub-520-partial-mixed-keep",
      "new-sub-520-partial-mixed-keep@example.com",
    );
    expect(error, `merge threw: ${String(error)}`).toBeNull();
    expect(result?.id).toBe(1);

    const after = new Database(file);
    try {
      // Survivor-wins on the total UNIQUE(user_id, date): the colliding loser
      // row is dropped, the other one moves.
      expect(after.prepare("SELECT id, user_id FROM journal ORDER BY id").all()).toEqual([
        { id: 1, user_id: 1 },
        { id: 3, user_id: 1 },
      ]);
    } finally {
      after.close();
    }
    const mergeLine = logged.find((l) => l.includes("[upsertUserByAppleSub] merged user"));
    expect(mergeLine).toMatch(/dropped\(survivor-wins, total=1\):[^;]*\bjournal=1\b/);
  });

  it("PR #520 review: a child table with ON DELETE CASCADE keeps its rows — the conflict path's DELETE must not cascade", () => {
    const file = newDbFile();
    const raw = new Database(file);
    // The reproduction from the review: attachments hanging off journal.
    raw.exec(`
      CREATE TABLE journal (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        date TEXT,
        UNIQUE (user_id, date)
      );
      CREATE TABLE journal_photos (
        id INTEGER PRIMARY KEY,
        journal_id INTEGER REFERENCES journal(id) ON DELETE CASCADE
      );
    `);
    raw.close();
    process.env.WHOOP_DB_PATH = file;
    conn.openWrite()?.close();

    // Routing: journal DOES carry a unique key on user_id, so the uniqueness
    // check alone would send it to the conflict path. The cascading child
    // overrides that — this is the assertion that discriminates, since with no
    // colliding row the conflict path would delete nothing and the photos
    // would survive either way.
    const check = conn.openWrite();
    try {
      expect(authMod.userIdUniqueKeys(check!, "journal")).toEqual([["user_id", "date"]]);
      expect(authMod.partitionOptionalMergeTables(check!, ["journal"])).toEqual({
        bare: ["journal"],
        conflict: [],
      });
    } finally {
      check?.close();
    }

    const goneId = seedSplitBrainUsers(file, "sub-520-cascade-keep", "sub-520-cascade-gone");
    const seed = new Database(file);
    try {
      seed.prepare("INSERT INTO journal (id, user_id, date) VALUES (1, 1, '2026-06-01')").run();
      // Loser rows on dates the survivor does not hold — no collision, so the
      // merge completes and every photo must come with them.
      seed.prepare("INSERT INTO journal (id, user_id, date) VALUES (2, ?, '2026-06-02')").run(goneId);
      seed.prepare("INSERT INTO journal (id, user_id, date) VALUES (3, ?, '2026-06-03')").run(goneId);
      seed.prepare("INSERT INTO journal_photos (id, journal_id) VALUES (10, 1)").run();
      seed.prepare("INSERT INTO journal_photos (id, journal_id) VALUES (11, 2)").run();
      seed.prepare("INSERT INTO journal_photos (id, journal_id) VALUES (12, 3)").run();
    } finally {
      seed.close();
    }

    const { result, error, logged } = mergeCapturingLogs(
      "sub-520-cascade-keep",
      "new-sub-520-cascade-keep@example.com",
    );
    expect(error, `merge threw: ${String(error)}`).toBeNull();
    expect(result?.id).toBe(1);

    const after = new Database(file);
    try {
      expect(after.prepare("SELECT id, user_id FROM journal ORDER BY id").all()).toEqual([
        { id: 1, user_id: 1 },
        { id: 2, user_id: 1 },
        { id: 3, user_id: 1 },
      ]);
      // The count the review found at zero.
      expect(
        (after.prepare("SELECT id FROM journal_photos").all() as unknown[]).length,
      ).toBe(3);
      expect(after.pragma("foreign_key_check")).toEqual([]);
    } finally {
      after.close();
    }

    const warned = logged.find((l) => l.includes("journal_photos"));
    expect(warned, `no cascade warning in: ${logged.join(" | ")}`).toBeDefined();
    expect(warned).toContain("ON DELETE CASCADE");
  });

  it("PR #520 review: with a cascading child, a genuine collision aborts loudly instead of destroying child rows", () => {
    const file = newDbFile();
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE journal (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        date TEXT,
        UNIQUE (user_id, date)
      );
      CREATE TABLE journal_photos (
        id INTEGER PRIMARY KEY,
        journal_id INTEGER REFERENCES journal(id) ON DELETE CASCADE
      );
    `);
    raw.close();
    process.env.WHOOP_DB_PATH = file;
    conn.openWrite()?.close();

    const goneId = seedSplitBrainUsers(file, "sub-520-cascade-clash-keep", "sub-520-cascade-clash-gone");
    const seed = new Database(file);
    try {
      seed.prepare("INSERT INTO journal (id, user_id, date) VALUES (1, 1, '2026-06-01')").run();
      // Same date on both accounts: the survivor-wins path would delete this
      // row and cascade its photo away.
      seed.prepare("INSERT INTO journal (id, user_id, date) VALUES (2, ?, '2026-06-01')").run(goneId);
      seed.prepare("INSERT INTO journal_photos (id, journal_id) VALUES (10, 1)").run();
      seed.prepare("INSERT INTO journal_photos (id, journal_id) VALUES (11, 2)").run();
    } finally {
      seed.close();
    }

    const { error } = mergeCapturingLogs(
      "sub-520-cascade-clash-keep",
      "new-sub-520-cascade-clash-keep@example.com",
    );
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/UNIQUE constraint failed/);

    const after = new Database(file);
    try {
      expect((after.prepare("SELECT id FROM journal_photos").all() as unknown[]).length).toBe(2);
      expect((after.prepare("SELECT id FROM journal").all() as unknown[]).length).toBe(2);
      expect((after.prepare("SELECT id FROM users").all() as unknown[]).length).toBe(2);
    } finally {
      after.close();
    }
  });
});
