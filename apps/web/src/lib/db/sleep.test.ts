import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Mirrors workouts.test.ts / users.test.ts: tmp dir, set env before
// importing the module, touch the file so better-sqlite3's fileMustExist
// check is satisfied, then open once via openWrite() to lazily create the
// sleep table.
const tmpRoot = mkdtempSync(path.join(tmpdir(), "sleep-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;
new Database(dbFile).close();

type SleepModule = typeof import("./sleep");
type ConnectionModule = typeof import("./connection");
let sleepMod: SleepModule;
let connection: ConnectionModule;

type SeedRow = {
  sleep_id: string;
  date: string;
  in_bed_ms: number;
  nap?: number;
  /** Distinguishing marker for tie-break assertions — SLEEP_COLUMNS exposes
   *  `efficiency` but not `sleep_id`, so this is how a test proves WHICH
   *  row won a tie. */
  efficiency?: number;
};

function insertSleep(rows: SeedRow[]): void {
  const db = new Database(dbFile);
  try {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (1)").run();
    const stmt = db.prepare(
      "INSERT INTO sleep (user_id, sleep_id, date, in_bed_ms, light_ms, deep_ms, rem_ms, nap, efficiency) " +
        "VALUES (1, ?, ?, ?, ?, 0, 0, ?, ?)",
    );
    const tx = db.transaction((items: SeedRow[]) => {
      for (const r of items) {
        // light_ms carries the same value as in_bed_ms so SLEEP_COLUMNS'
        // consumers (and the tests below) have a nonzero, distinguishing
        // figure to assert on without needing every column populated.
        stmt.run(r.sleep_id, r.date, r.in_bed_ms, r.in_bed_ms, r.nap ?? 0, r.efficiency ?? null);
      }
    });
    tx(rows);
  } finally {
    db.close();
  }
}

function clearSleep(): void {
  const db = new Database(dbFile);
  try {
    db.prepare("DELETE FROM sleep WHERE user_id = 1").run();
  } finally {
    db.close();
  }
}

describe("sleep read selectors — one row per date (issue #440)", () => {
  beforeAll(async () => {
    connection = await import("./connection");
    sleepMod = await import("./sleep");
    // Trigger schema bootstrap (lazy CREATE TABLE sleep + Phase D rebuild).
    const db = connection.openWrite();
    db?.close();
  });

  beforeEach(() => {
    clearSleep();
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  // Two non-nap sleeps legitimately ending on the same local date (wake
  // 03:00, sleep again, wake 09:00) — wake-day attribution doesn't remove
  // this case, so the read side must still pick exactly one, deterministically.
  it("getLatestSleep returns exactly one row when two non-nap sleeps share a date, picking the longer", () => {
    insertSleep([
      { sleep_id: "short", date: "2026-04-29", in_bed_ms: 10 * 60_000 },
      { sleep_id: "long", date: "2026-04-29", in_bed_ms: 8 * 3_600_000 },
    ]);

    const row = sleepMod.getLatestSleep(1);
    expect(row).not.toBeNull();
    expect(row!.date).toBe("2026-04-29");
    expect(row!.in_bed_ms).toBe(8 * 3_600_000);
  });

  it("getSleepTrend returns exactly one row per date across a collision", () => {
    insertSleep([
      { sleep_id: "short", date: "2026-04-29", in_bed_ms: 10 * 60_000 },
      { sleep_id: "long", date: "2026-04-29", in_bed_ms: 8 * 3_600_000 },
      { sleep_id: "other-day", date: "2026-04-28", in_bed_ms: 7 * 3_600_000 },
    ]);

    const rows = sleepMod.getSleepTrend(1, 30);
    const dates = rows.map((r) => r.date);
    expect(dates).toEqual(["2026-04-28", "2026-04-29"]);
    const collision = rows.find((r) => r.date === "2026-04-29")!;
    expect(collision.in_bed_ms).toBe(8 * 3_600_000);
  });

  it("getSleepRange returns exactly one row per date across a collision", () => {
    insertSleep([
      { sleep_id: "short", date: "2026-04-29", in_bed_ms: 10 * 60_000 },
      { sleep_id: "long", date: "2026-04-29", in_bed_ms: 8 * 3_600_000 },
    ]);

    const rows = sleepMod.getSleepRange(1, "2026-04-01", "2026-04-30");
    expect(rows).toHaveLength(1);
    expect(rows[0].in_bed_ms).toBe(8 * 3_600_000);
  });

  it("getFullSleepTrend returns exactly one row per date across a collision", () => {
    insertSleep([
      { sleep_id: "short", date: "2026-04-29", in_bed_ms: 10 * 60_000 },
      { sleep_id: "long", date: "2026-04-29", in_bed_ms: 8 * 3_600_000 },
    ]);

    const rows = sleepMod.getFullSleepTrend(1, 30);
    expect(rows).toHaveLength(1);
    expect(rows[0].in_bed_ms).toBe(8 * 3_600_000);
  });

  it("tie-breaks on sleep_id (descending) when in_bed_ms is equal", () => {
    insertSleep([
      { sleep_id: "aaa", date: "2026-04-29", in_bed_ms: 8 * 3_600_000, efficiency: 70 },
      { sleep_id: "zzz", date: "2026-04-29", in_bed_ms: 8 * 3_600_000, efficiency: 91 },
    ]);

    // "zzz" sorts after "aaa" — the tie-break must pick it, not whichever
    // row SQLite happens to return first. Repeated calls must agree.
    const first = sleepMod.getLatestSleep(1);
    const second = sleepMod.getLatestSleep(1);
    expect(first!.efficiency).toBe(91);
    expect(first).toEqual(second);
  });

  it("getPreviousSleep skips the winning latest row and returns the next date's winner", () => {
    insertSleep([
      { sleep_id: "short", date: "2026-04-29", in_bed_ms: 10 * 60_000 },
      { sleep_id: "long", date: "2026-04-29", in_bed_ms: 8 * 3_600_000 },
      { sleep_id: "prior", date: "2026-04-28", in_bed_ms: 7 * 3_600_000 },
    ]);

    const latest = sleepMod.getLatestSleep(1);
    const previous = sleepMod.getPreviousSleep(1);
    expect(latest!.date).toBe("2026-04-29");
    expect(previous!.date).toBe("2026-04-28");
  });

  it("naps are unaffected — multiple naps on one date are not deduped", () => {
    insertSleep([
      { sleep_id: "nap-1", date: "2026-04-29", in_bed_ms: 20 * 60_000, nap: 1 },
      { sleep_id: "nap-2", date: "2026-04-29", in_bed_ms: 30 * 60_000, nap: 1 },
    ]);

    // Naps aren't read through sleep.ts's non-nap selectors at all.
    expect(sleepMod.getLatestSleep(1)).toBeNull();
    expect(sleepMod.getSleepTrend(1, 30)).toHaveLength(0);
  });

  // Issue #440 review, second pass, NIT: getSleepRangeRaw (the Coach's
  // query_sleep tool) is the deliberate exception to the dedup rule — pin
  // it against getSleepRange so a future edit can't quietly make them
  // identical (which would silently reintroduce data suppression in the
  // Coach tool) or quietly make Raw dedupe too (defeating its purpose).
  it("getSleepRangeRaw returns BOTH rows on a collision date; getSleepRange returns one", () => {
    insertSleep([
      { sleep_id: "short", date: "2026-04-29", in_bed_ms: 10 * 60_000 },
      { sleep_id: "long", date: "2026-04-29", in_bed_ms: 8 * 3_600_000 },
    ]);

    const raw = sleepMod.getSleepRangeRaw(1, "2026-04-01", "2026-04-30");
    const deduped = sleepMod.getSleepRange(1, "2026-04-01", "2026-04-30");

    expect(raw).toHaveLength(2);
    expect(raw.map((r) => r.in_bed_ms).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      10 * 60_000,
      8 * 3_600_000,
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].in_bed_ms).toBe(8 * 3_600_000);
  });
});
