// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "similar-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;
new Database(dbFile).close();

let workouts: typeof import("./workouts");

beforeAll(async () => {
  const conn = await import("./connection");
  workouts = await import("./workouts");
  conn.openWrite()?.close();
});

beforeEach(() => {
  const db = new Database(dbFile);
  try {
    db.prepare("DELETE FROM workouts").run();
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (1)").run();
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (2)").run();
  } finally {
    db.close();
  }
});

afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

function seed(userId: number, id: string, date: string, sport: string | null, duration = 3600): void {
  const db = new Database(dbFile);
  try {
    db.prepare(
      "INSERT INTO workouts (user_id, id, date, sport, duration_sec) VALUES (?, ?, ?, ?, ?)",
    ).run(userId, id, date, sport, duration);
  } finally {
    db.close();
  }
}

describe("getSimilarWorkoutCandidates", () => {
  it("returns same-sport rows for this user only, excluding the session, inside the range", () => {
    seed(1, "t", "2026-11-20", "Running");
    seed(1, "a", "2026-11-10", "running ");
    seed(1, "b", "2026-11-12", "Cycling");
    seed(1, "old", "2025-01-01", "Running");
    seed(1, "next-month", "2026-12-01", "Running");
    seed(2, "other-user", "2026-11-11", "Running");
    const rows = workouts.getSimilarWorkoutCandidates(1, "Running", "t", "2025-11-20", "2026-11-30");
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("null sport matches null and blank sports", () => {
    seed(1, "t", "2026-11-20", null);
    seed(1, "n", "2026-11-10", null);
    seed(1, "blank", "2026-11-11", "  ");
    seed(1, "r", "2026-11-12", "Running");
    const rows = workouts.getSimilarWorkoutCandidates(1, null, "t", "2026-01-01", "2026-11-30");
    expect(rows.map((r) => r.id).sort()).toEqual(["blank", "n"]);
  });

  it("is bounded by SIMILAR_CANDIDATES_LIMIT, newest first", () => {
    const db = new Database(dbFile);
    const ins = db.prepare(
      "INSERT INTO workouts (user_id, id, date, sport, duration_sec) VALUES (1, ?, ?, 'Running', 3600)",
    );
    db.transaction(() => {
      for (let i = 0; i < workouts.SIMILAR_CANDIDATES_LIMIT + 20; i++) {
        const d = new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString().slice(0, 10);
        ins.run(`x${i}`, d);
      }
    })();
    db.close();
    const rows = workouts.getSimilarWorkoutCandidates(1, "Running", "none", "2025-01-01", "2026-12-31");
    expect(rows).toHaveLength(workouts.SIMILAR_CANDIDATES_LIMIT);
    expect(rows[0].date >= rows[rows.length - 1].date).toBe(true);
  });
});
