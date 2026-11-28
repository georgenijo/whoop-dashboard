import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Real SQLite through the real tenant-scoped readers: two users share every
// table and the same dates, and each one's Day page must see only its own rows.
const tmpRoot = mkdtempSync(path.join(tmpdir(), "day-detail-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;
new Database(dbFile).close();

type LoaderModule = typeof import("./day-detail");
let loader: LoaderModule;

const DAY = "2026-03-08"; // US DST start — date keys must not shift

function seed(): void {
  const db = new Database(dbFile);
  try {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (1), (2)").run();
    const rec = db.prepare(
      "INSERT INTO recovery (user_id, date, recovery_score, hrv, rhr, spo2, skin_temp) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const cyc = db.prepare("INSERT INTO cycles (user_id, date, strain, kilojoule, avg_hr, max_hr) VALUES (?, ?, ?, ?, ?, ?)");
    const slp = db.prepare(
      "INSERT INTO sleep (user_id, sleep_id, date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, performance, nap) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const wk = db.prepare(
      "INSERT INTO workouts (id, user_id, date, sport, duration_sec, strain, raw) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const sum = db.prepare("INSERT INTO daily_summary (user_id, date, day_strain) VALUES (?, ?, ?)");

    rec.run(1, DAY, 80, 70, 50, 97, 33.1);
    rec.run(2, DAY, 20, 25, 65, 94, 34.0);
    cyc.run(1, DAY, 12.5, 9000, 70, 170);
    cyc.run(2, DAY, 3.3, 7000, 60, 120);
    slp.run(1, "s1", DAY, 28_800_000, 14_400_000, 5_400_000, 5_400_000, 3_600_000, 90, 0);
    slp.run(1, "n1", DAY, 1_200_000, 1_200_000, 0, 0, 0, null, 1);
    slp.run(2, "s2", DAY, 18_000_000, 9_000_000, 3_600_000, 3_600_000, 1_800_000, 40, 0);
    wk.run("w-u1", 1, DAY, "Running", 1800, 10, JSON.stringify({ start: "2026-03-08T12:00:00.000Z" }));
    wk.run("w-u2", 2, DAY, "Rowing", 3600, 15, JSON.stringify({ start: "2026-03-08T13:00:00.000Z" }));
    sum.run(1, "2026-03-01", 5);
    sum.run(1, DAY, 12.5);
    sum.run(2, "2026-02-01", 4);
    sum.run(2, DAY, 3.3);
  } finally {
    db.close();
  }
}

describe("loadDayDetail (real DB, tenant isolation)", () => {
  beforeAll(async () => {
    const connection = await import("./db/connection");
    connection.openWrite()?.close();
    seed();
    loader = await import("./day-detail");
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("user 1 sees only their own rows", () => {
    const d = loader.loadDayDetail(1, DAY, "2026-03-10", "America/New_York");
    expect(d.recovery).toMatchObject({ score: 80, hrv: 70 });
    expect(d.strain?.strain).toBe(12.5);
    expect(d.sleep?.performance).toBe(90);
    expect(d.naps.count).toBe(1);
    expect(d.workouts.map((w) => w.id)).toEqual(["w-u1"]);
    // 12:00Z on DST-start day is 8:00 AM EDT (UTC-4), not 7:00 AM EST.
    expect(d.workouts[0].startTime).toBe("8:00 AM");
    expect(d.pickerDates).toEqual([DAY, "2026-03-01"]);
    expect(d.prevWithData).toBe("2026-03-01");
    expect(d.journal).toEqual([]); // no journal table → empty, no throw
  });

  it("user 2 sees only their own rows", () => {
    const d = loader.loadDayDetail(2, DAY, "2026-03-10", "UTC");
    expect(d.recovery).toMatchObject({ score: 20, band: "red" });
    expect(d.strain?.strain).toBe(3.3);
    expect(d.sleep?.performance).toBe(40);
    expect(d.naps.count).toBe(0);
    expect(d.workouts.map((w) => w.id)).toEqual(["w-u2"]);
    expect(d.pickerDates).toEqual([DAY, "2026-02-01"]);
  });

  it("a user with no rows gets the empty day, not someone else's", () => {
    const d = loader.loadDayDetail(3, DAY, "2026-03-10", "UTC");
    expect(d.hasAnyData).toBe(false);
    expect(d.pickerDates).toEqual([]);
  });

  it("picker excludes dates after today", () => {
    const d = loader.loadDayDetail(1, "2026-03-01", "2026-03-05", "UTC");
    expect(d.pickerDates).toEqual(["2026-03-01"]);
    expect(d.nextWithData).toBeNull();
  });
});
