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

  it("recovery / cycles / sleep / daily_summary: PRIMARY KEY is (user_id, date)", () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    const db = conn.openWrite();
    try {
      for (const t of ["recovery", "cycles", "sleep", "daily_summary"]) {
        const pkCols = (
          db!
            .prepare(`PRAGMA table_info(${t})`)
            .all() as { name: string; pk: number }[]
        )
          .filter((c) => c.pk > 0)
          .sort((a, b) => a.pk - b.pk)
          .map((c) => c.name);
        expect(pkCols, `${t} pk`).toEqual(["user_id", "date"]);
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
