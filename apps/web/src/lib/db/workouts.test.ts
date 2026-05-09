import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("sanitizeLimit", () => {
  // sanitizeLimit doesn't need the real DB — mock the connection module out
  // so this block stays cheap and self-contained.
  const DEFAULT = 50;
  const MAX = 500;

  let sanitizeLimit: (limit: unknown) => number;

  beforeAll(async () => {
    vi.doMock("./connection", () => ({
      dateRangeClause: () => ({ clause: "", params: [] }),
      hasTable: () => false,
      safeQuery: () => null,
    }));
    const mod = await import("./workouts");
    sanitizeLimit = mod.sanitizeLimit;
  });

  afterAll(() => {
    vi.doUnmock("./connection");
    vi.resetModules();
  });

  it("returns default for undefined", () => {
    expect(sanitizeLimit(undefined)).toBe(DEFAULT);
  });

  it("returns default for non-number input", () => {
    expect(sanitizeLimit("100")).toBe(DEFAULT);
    expect(sanitizeLimit(null)).toBe(DEFAULT);
    expect(sanitizeLimit({})).toBe(DEFAULT);
  });

  it("returns default for NaN", () => {
    expect(sanitizeLimit(NaN)).toBe(DEFAULT);
  });

  it("returns default for Infinity", () => {
    expect(sanitizeLimit(Infinity)).toBe(DEFAULT);
    expect(sanitizeLimit(-Infinity)).toBe(DEFAULT);
  });

  it("returns default for zero", () => {
    expect(sanitizeLimit(0)).toBe(DEFAULT);
  });

  it("returns default for negative numbers", () => {
    expect(sanitizeLimit(-1)).toBe(DEFAULT);
    expect(sanitizeLimit(-1000)).toBe(DEFAULT);
  });

  it("returns default for fractional values that floor to 0 (regression: 0.5 must NOT yield LIMIT 0)", () => {
    expect(sanitizeLimit(0.5)).toBe(DEFAULT);
    expect(sanitizeLimit(0.99)).toBe(DEFAULT);
  });

  it("floors positive fractional values to integers", () => {
    expect(sanitizeLimit(10.7)).toBe(10);
    expect(sanitizeLimit(1.1)).toBe(1);
  });

  it("returns the value when within range", () => {
    expect(sanitizeLimit(1)).toBe(1);
    expect(sanitizeLimit(50)).toBe(50);
    expect(sanitizeLimit(500)).toBe(500);
  });

  it("caps over-limit values at MAX_WORKOUTS_LIMIT (500)", () => {
    expect(sanitizeLimit(501)).toBe(MAX);
    expect(sanitizeLimit(1_000_000)).toBe(MAX);
    expect(sanitizeLimit(Number.MAX_SAFE_INTEGER)).toBe(MAX);
  });
});

// getWorkoutsRange exercises the real SQLite path via WHOOP_DB_PATH override.
// Mirrors users.test.ts: tmp dir, set env before importing the module, touch
// the file so better-sqlite3's fileMustExist check is satisfied, then open
// once via openWrite() to lazily create the workouts table.
const tmpRoot = mkdtempSync(path.join(tmpdir(), "workouts-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;
new Database(dbFile).close();

type WorkoutsModule = typeof import("./workouts");
type ConnectionModule = typeof import("./connection");
let workouts: WorkoutsModule;
let connection: ConnectionModule;

function insertWorkouts(
  rows: Array<{ id: string; date: string; sport?: string | null }>
): void {
  const db = new Database(dbFile);
  try {
    const stmt = db.prepare(
      "INSERT INTO workouts (id, date, sport) VALUES (?, ?, ?)"
    );
    const tx = db.transaction(
      (items: Array<{ id: string; date: string; sport?: string | null }>) => {
        for (const r of items) stmt.run(r.id, r.date, r.sport ?? null);
      }
    );
    tx(rows);
  } finally {
    db.close();
  }
}

function clearWorkouts(): void {
  const db = new Database(dbFile);
  try {
    db.prepare("DELETE FROM workouts").run();
  } finally {
    db.close();
  }
}

describe("getWorkoutsRange", () => {
  beforeAll(async () => {
    // Force a fresh import so the real connection module is loaded (the
    // sanitizeLimit block above mocks it then unmocks; resetModules ensures
    // we start from a clean cache).
    vi.resetModules();
    connection = await import("./connection");
    workouts = await import("./workouts");
    // Trigger schema bootstrap (lazy CREATE TABLE workouts).
    const db = connection.openWrite();
    db?.close();
  });

  beforeEach(() => {
    clearWorkouts();
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns empty result for a range with no workouts", () => {
    const result = workouts.getWorkoutsRange("2026-01-01", "2026-01-31");
    expect(result).toEqual({ rows: [], truncated: false, total_count: 0 });
  });

  it("returns all rows un-truncated when count <= MAX_WORKOUTS_LIMIT", () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: `w-${i}`,
      // Spread across Jan-Feb 2026 so date ordering is meaningful.
      date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      sport: "running",
    }));
    insertWorkouts(rows);

    const result = workouts.getWorkoutsRange("2026-01-01", "2026-02-28");
    expect(result.rows.length).toBe(50);
    expect(result.truncated).toBe(false);
    expect(result.total_count).toBe(50);
  });

  it("truncates to 500 most-recent rows when the range holds 510, with total_count=510", () => {
    // 510 rows across 510 distinct dates so DESC ordering picks an
    // unambiguous "most recent 500".
    const rows = Array.from({ length: 510 }, (_, i) => {
      const d = new Date(Date.UTC(2024, 0, 1));
      d.setUTCDate(d.getUTCDate() + i);
      return {
        id: `w-${i}`,
        date: d.toISOString().slice(0, 10),
        sport: "running",
      };
    });
    insertWorkouts(rows);

    const result = workouts.getWorkoutsRange("2024-01-01", "2026-12-31");
    expect(result.rows.length).toBe(500);
    expect(result.truncated).toBe(true);
    expect(result.total_count).toBe(510);
    // The 500 most recent must be w-509 down to w-10; the oldest 10
    // (w-0..w-9) are dropped. Locks both DESC ordering and the slice.
    expect(result.rows[0].id).toBe("w-509");
    expect(result.rows[result.rows.length - 1].id).toBe("w-10");
    expect(result.rows.map((r) => r.id)).not.toContain("w-0");
  });

  it("returns rows in DESC date order (most recent first)", () => {
    insertWorkouts([
      { id: "w-old", date: "2026-01-01" },
      { id: "w-mid", date: "2026-01-15" },
      { id: "w-new", date: "2026-01-31" },
    ]);

    const result = workouts.getWorkoutsRange("2026-01-01", "2026-01-31");
    expect(result.rows.map((r) => r.id)).toEqual(["w-new", "w-mid", "w-old"]);
  });
});
