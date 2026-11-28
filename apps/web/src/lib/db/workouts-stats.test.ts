// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "stats-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;
new Database(dbFile).close();

type WorkoutsModule = typeof import("./workouts");
let workouts: WorkoutsModule;
let conn: typeof import("./connection");

beforeAll(async () => {
  conn = await import("./connection");
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

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function seed(
  userId: number,
  id: string,
  date: string,
  fields: Partial<{
    sport: string;
    duration_sec: number;
    distance_m: number;
    kilojoule: number;
    strain: number;
    max_hr: number;
    avg_hr: number;
  }>,
): void {
  const db = new Database(dbFile);
  try {
    db.prepare(
      `INSERT INTO workouts
        (user_id, id, date, sport, duration_sec, distance_m, kilojoule, strain, max_hr, avg_hr)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      id,
      date,
      fields.sport ?? null,
      fields.duration_sec ?? null,
      fields.distance_m ?? null,
      fields.kilojoule ?? null,
      fields.strain ?? null,
      fields.max_hr ?? null,
      fields.avg_hr ?? null,
    );
  } finally {
    db.close();
  }
}

describe("getAllTimeStats", () => {
  it("sums totals for the user and isolates other users", () => {
    seed(1, "a", "2026-01-10", { duration_sec: 3600, kilojoule: 2000, distance_m: 5000 });
    seed(1, "b", "2026-02-10", { duration_sec: 1800, kilojoule: 1000 });
    seed(2, "c", "2026-02-10", { duration_sec: 9999, kilojoule: 9999 });

    const s = workouts.getAllTimeStats(1);
    expect(s.workouts).toBe(2);
    expect(s.activeSeconds).toBe(5400);
    expect(s.kilojoules).toBe(3000);
    // only one workout carries distance — SUM still returns it, not null
    expect(s.distanceMeters).toBe(5000);
  });

  it("returns null distance when no workout has distance data (honest, not 0)", () => {
    seed(1, "a", "2026-01-10", { duration_sec: 3600, kilojoule: 2000 });
    const s = workouts.getAllTimeStats(1);
    expect(s.workouts).toBe(1);
    expect(s.distanceMeters).toBeNull();
  });

  it("zero workouts → zero count, null sums", () => {
    const s = workouts.getAllTimeStats(1);
    expect(s.workouts).toBe(0);
    expect(s.activeSeconds).toBeNull();
    expect(s.kilojoules).toBeNull();
    expect(s.distanceMeters).toBeNull();
  });
});

describe("getYearComparison", () => {
  it("compares same-period current vs prior year with deltas + sparks", () => {
    const year = new Date().getFullYear();
    seed(1, "a", `${year}-01-05`, { duration_sec: 3600, kilojoule: 4184, distance_m: 3218 });
    seed(1, "b", `${year}-02-05`, { duration_sec: 3600, kilojoule: 4184 });
    seed(1, "c", `${year - 1}-01-05`, { duration_sec: 3600, kilojoule: 4184 });

    const yoy = workouts.getYearComparison(1, year);
    expect(yoy.year).toBe(year);
    expect(yoy.priorYear).toBe(year - 1);
    expect(yoy.workouts.current).toBe(2);
    expect(yoy.workouts.prior).toBe(1);
    expect(yoy.workouts.delta).toBe(1);
    // active hours: 2*3600s = 2h current, 1h prior
    expect(yoy.activeHours.current).toBeCloseTo(2);
    expect(yoy.activeHours.delta).toBeCloseTo(1);
    // distance only in current → prior null → delta null
    expect(yoy.distanceMeters.current).toBe(3218);
    expect(yoy.distanceMeters.prior).toBeNull();
    expect(yoy.distanceMeters.delta).toBeNull();
    expect(yoy.workouts.spark.length).toBeGreaterThan(0);
  });
});

describe("getSportBreakdown + getMonthlyRollup", () => {
  it("groups by sport busiest-first within the window", () => {
    seed(1, "a", "2026-04-01", { sport: "Walking" });
    seed(1, "b", "2026-04-02", { sport: "Walking" });
    seed(1, "c", "2026-04-03", { sport: "Running" });
    const rows = workouts.getSportBreakdown(1, "2026-01-01", "2026-12-31");
    expect(rows[0]).toEqual({ sport: "Walking", count: 2 });
    expect(rows[1]).toEqual({ sport: "Running", count: 1 });
  });

  it("rolls up per month with avg strain and partial flags", () => {
    seed(1, "a", "2026-01-10", { strain: 8 });
    seed(1, "b", "2026-01-20", { strain: 10 });
    seed(1, "future", "2026-02-01", { strain: 20 });
    const rows = workouts.getMonthlyRollup(1, "2026-01-01", "2026-01-31");
    const jan = rows.find((r) => r.month === "2026-01");
    expect(jan?.count).toBe(2);
    expect(jan?.avgStrain).toBeCloseTo(9);
    expect(rows.some((r) => r.month === "2026-02")).toBe(false);
  });
});

describe("getPersonalRecords", () => {
  it("picks the max session and tags sport + date; nulls when absent", () => {
    seed(1, "a", "2026-03-14", { sport: "Cycling", duration_sec: 3600, strain: 19.4 });
    seed(1, "b", "2026-06-27", { sport: "Soccer", duration_sec: 6120, strain: 12.0 });

    const pr = workouts.getPersonalRecords(1);
    expect(pr.longestSessionSec.value).toBe(6120);
    expect(pr.longestSessionSec.meta).toContain("Soccer");
    expect(pr.highestStrain.value).toBeCloseTo(19.4);
    expect(pr.highestStrain.meta).toContain("Cycling");
    // no max_hr seeded
    expect(pr.topHr.value).toBeNull();
    expect(pr.topHr.meta).toBeNull();
  });
});

describe("per-sport filter (issue #430)", () => {
  function seedMix(): void {
    seed(1, "r1", "2026-03-02", { sport: "Running", strain: 10, avg_hr: 150 });
    seed(1, "r2", "2026-03-20", { sport: "Running", strain: 14, avg_hr: 160 });
    seed(1, "r3", "2026-04-05", { sport: "Running", strain: 12 });
    seed(1, "w1", "2026-03-10", { sport: "Walking", strain: 4, avg_hr: 100 });
    seed(1, "h1", "2026-03-11", { sport: "HIIT/Circuit", strain: 15 });
    seed(1, "n1", "2026-03-12", {}); // NULL sport → "Unknown" in the breakdown
    seed(2, "x1", "2026-03-05", { sport: "Running", strain: 20, avg_hr: 190 });
  }

  it("lists only that sport's sessions for the user, newest first", () => {
    seedMix();
    const rows = workouts.getWorkoutRowsRange(1, "2026-01-01", "2026-12-31", "Running");
    expect(rows.map((r) => r.id)).toEqual(["r3", "r2", "r1"]);
    expect(rows.every((r) => r.sport === "Running")).toBe(true);
    // window still applies on top of the sport filter
    expect(
      workouts.getWorkoutRowsRange(1, "2026-04-01", "2026-04-30", "Running").map((r) => r.id),
    ).toEqual(["r3"]);
  });

  it("matches names with reserved URL characters exactly", () => {
    seedMix();
    expect(
      workouts.getWorkoutRowsRange(1, "2026-01-01", "2026-12-31", "HIIT/Circuit").map((r) => r.id),
    ).toEqual(["h1"]);
  });

  it("drills the breakdown's Unknown row into the NULL-sport sessions", () => {
    seedMix();
    const unknown = workouts
      .getSportBreakdown(1, "2026-01-01", "2026-12-31")
      .find((r) => r.sport === "Unknown");
    const rows = workouts.getWorkoutRowsRange(1, "2026-01-01", "2026-12-31", "Unknown");
    expect(rows.map((r) => r.id)).toEqual(["n1"]);
    expect(rows.length).toBe(unknown?.count);
  });

  it("every breakdown count equals its drill-down list length", () => {
    seedMix();
    for (const b of workouts.getSportBreakdown(1, "2026-01-01", "2026-12-31")) {
      expect(workouts.getWorkoutRowsRange(1, "2026-01-01", "2026-12-31", b.sport)).toHaveLength(
        b.count,
      );
    }
  });

  it("returns nothing for a sport the user never logged", () => {
    seedMix();
    expect(workouts.getWorkoutRowsRange(1, "2026-01-01", "2026-12-31", "Rowing")).toEqual([]);
    expect(workouts.getMonthlyRollup(1, "2026-01-01", "2026-12-31", "Rowing")).toEqual([]);
  });

  it("rolls up strain and avg HR per month for one sport only", () => {
    seedMix();
    const rows = workouts.getMonthlyRollup(1, "2026-01-01", "2026-12-31", "Running");
    expect(rows.map((r) => r.month)).toEqual(["2026-03", "2026-04"]);
    const [mar, apr] = rows;
    expect(mar.count).toBe(2);
    expect(mar.avgStrain).toBeCloseTo(12);
    expect(mar.avgHr).toBeCloseTo(155); // Walking (100) and user 2 (190) excluded
    expect(apr.count).toBe(1);
    expect(apr.avgHr).toBeNull(); // no HR on r3 — honest null, not 0
  });

  it("omitting sport keeps the all-sport rollup", () => {
    seedMix();
    const mar = workouts
      .getMonthlyRollup(1, "2026-03-01", "2026-03-31")
      .find((r) => r.month === "2026-03");
    expect(mar?.count).toBe(5);
    expect(mar?.avgHr).toBeCloseTo((150 + 160 + 100) / 3);
  });
});
