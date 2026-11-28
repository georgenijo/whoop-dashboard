import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Tenant isolation through the REAL user-scoped readers the /report page uses:
// two users share every date, and each report must see only its own rows.
const tmpRoot = mkdtempSync(path.join(tmpdir(), "health-report-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;
new Database(dbFile).close();

type Db = typeof import("@/lib/db");
type Report = typeof import("./healthReport");
let db: Db;
let hr: Report;

const H = 3_600_000;

function seed(userId: number, score: number, sleepH: number, strain: number, workouts: number) {
  const d = new Database(dbFile);
  try {
    d.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(userId);
    for (const date of ["2026-11-25", "2026-11-26", "2026-11-27"]) {
      d.prepare(
        "INSERT INTO recovery (user_id, date, recovery_score, hrv, rhr, spo2, skin_temp) VALUES (?, ?, ?, 50, 50, NULL, NULL)",
      ).run(userId, date, score);
      d.prepare(
        "INSERT INTO sleep (user_id, sleep_id, date, in_bed_ms, light_ms, deep_ms, rem_ms, nap) VALUES (?, ?, ?, ?, ?, 0, 0, 0)",
      ).run(userId, `s-${userId}-${date}`, date, sleepH * H, sleepH * H);
      d.prepare("INSERT INTO cycles (user_id, date, strain) VALUES (?, ?, ?)").run(userId, date, strain);
    }
    for (let i = 0; i < workouts; i++) {
      d.prepare("INSERT INTO workouts (id, user_id, date, sport, duration_sec, raw) VALUES (?, ?, '2026-11-26', 'running', 600, '{}')").run(
        `w-${userId}-${i}`,
        userId,
      );
    }
  } finally {
    d.close();
  }
}

function reportFor(userId: number) {
  const { start, end } = hr.reportWindow("2026-11-27", 7);
  return hr.computeHealthReport({
    today: "2026-11-27",
    days: 7,
    recovery: db.getRecoveryRange(userId, start, end),
    sleep: db.getSleepRange(userId, start, end),
    cycles: db.getStrainRange(userId, start, end),
    workouts: db.getWorkoutRowsRange(userId, start, end),
  });
}

describe("health report tenant isolation", () => {
  beforeAll(async () => {
    const connection = await import("@/lib/db/connection");
    connection.openWrite()?.close();
    db = await import("@/lib/db");
    hr = await import("./healthReport");
    seed(1, 90, 8, 15, 3);
    seed(2, 20, 5, 4, 1);
  });

  afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it("each user's report reflects only their own rows", () => {
    const a = reportFor(1);
    const b = reportFor(2);
    const val = (r: ReturnType<typeof reportFor>, k: string) => r.metrics.find((m) => m.key === k)!.stat!.avg;

    expect(a.coverage.recoveryDays).toBe(3);
    expect(val(a, "recovery")).toBe(90);
    expect(val(a, "sleepHours")).toBe(8);
    expect(val(a, "strain")).toBe(15);
    expect(a.workouts).toEqual({ count: 3, totalSec: 1800 });

    expect(b.coverage.recoveryDays).toBe(3);
    expect(val(b, "recovery")).toBe(20);
    expect(val(b, "sleepHours")).toBe(5);
    expect(val(b, "strain")).toBe(4);
    expect(b.workouts).toEqual({ count: 1, totalSec: 600 });
  });

  it("a user with no rows gets an empty report, not someone else's", () => {
    const c = reportFor(3);
    expect(c.empty).toBe(true);
    expect(c.coverage.recoveryDays).toBe(0);
  });
});
