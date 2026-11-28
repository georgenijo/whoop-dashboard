// @vitest-environment node
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "overview-brief-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;
new Database(dbFile).close();

type ReaderModule = typeof import("./morning-brief");
let reader: ReaderModule;

// 2026-11-28 03:30 UTC = Nov 27 22:30 in New York, Nov 28 12:30 in Tokyo.
const NOW = new Date("2026-11-28T03:30:00.000Z");

function seed(): void {
  const db = new Database(dbFile);
  try {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (1), (2)").run();
    const recovery = db.prepare(
      "INSERT INTO recovery (user_id, date, recovery_score, hrv, rhr) VALUES (?, ?, ?, 60, 50)",
    );
    const sleep = db.prepare(
      "INSERT INTO sleep (user_id, sleep_id, date, in_bed_ms, light_ms, deep_ms, rem_ms, nap) VALUES (?, ?, ?, 1, 1, 1, 1, ?)",
    );
    const cycles = db.prepare("INSERT INTO cycles (user_id, date, strain) VALUES (?, ?, ?)");
    const workouts = db.prepare("INSERT INTO workouts (user_id, id, date, sport) VALUES (?, ?, ?, ?)");
    for (const date of ["2026-10-27", "2026-10-28", "2026-11-26", "2026-11-27", "2026-11-28"]) {
      recovery.run(1, date, 70);
      sleep.run(1, `s-${date}`, date, 0);
      cycles.run(1, date, 10);
      workouts.run(1, `w-${date}`, date, "running");
    }
    sleep.run(1, "nap-1", "2026-11-27", 1);
    // Another tenant on the same dates must never leak in.
    recovery.run(2, "2026-11-27", 5);
    workouts.run(2, "w2", "2026-11-26", "rowing");
  } finally {
    db.close();
  }
}

describe("readOverviewMorningBriefInputs", () => {
  beforeAll(async () => {
    const connection = await import("./connection");
    connection.openWrite()?.close();
    seed();
    reader = await import("./morning-brief");
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("resolves today in the user's zone and reads a 30-day user-scoped window", () => {
    const got = reader.readOverviewMorningBriefInputs(1, ["America/New_York"], NOW);
    expect(got.today).toBe("2026-11-27");
    expect(got.recovery.map((r) => r.date)).toEqual(["2026-10-28", "2026-11-26", "2026-11-27"]);
    expect(got.recovery.every((r) => r.recovery_score === 70)).toBe(true);
    expect(got.sleep.map((s) => s.date)).toEqual(["2026-10-28", "2026-11-26", "2026-11-27"]);
    expect(got.cycles.map((c) => c.date)).toEqual(["2026-10-28", "2026-11-26", "2026-11-27"]);
    expect(got.workouts.map((w) => w.sport)).toEqual(["running", "running", "running"]);
  });

  it("a zone already past midnight sees the next day", () => {
    const got = reader.readOverviewMorningBriefInputs(1, ["Asia/Tokyo"], NOW);
    expect(got.today).toBe("2026-11-28");
    expect(got.recovery.at(-1)?.date).toBe("2026-11-28");
    // Window is [today − 30, today]: Oct 28 falls out once today is Nov 28.
    expect(got.recovery[0].date).toBe("2026-11-26");
  });

  it("skips blank/invalid zones and falls through to the next candidate", () => {
    const got = reader.readOverviewMorningBriefInputs(1, [null, "  ", "Not/AZone", "Asia/Tokyo"], NOW);
    expect(got.today).toBe("2026-11-28");
  });

  it("returns only the other tenant's own rows", () => {
    const got = reader.readOverviewMorningBriefInputs(2, ["America/New_York"], NOW);
    expect(got.recovery.map((r) => r.recovery_score)).toEqual([5]);
    expect(got.workouts.map((w) => w.sport)).toEqual(["rowing"]);
    expect(got.sleep).toEqual([]);
  });

  it("empty user gets empty arrays", () => {
    const got = reader.readOverviewMorningBriefInputs(99, ["UTC"], NOW);
    expect(got).toMatchObject({ today: "2026-11-28", recovery: [], sleep: [], cycles: [], workouts: [] });
  });
});
