// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { openWrite } from "./connection";
import { getRecoveryRange } from "./recovery";
import { getNaps, getSleepRangeRaw } from "./sleep";
import { getStrainRange } from "./strain";
import { getWorkoutRowsRange } from "./workouts";
import { addSyncLog, getSyncLogs } from "./logs";
import { buildDataHealth } from "@/lib/analytics/dataHealth";

const tmpRoot = mkdtempSync(path.join(tmpdir(), "whoop-data-health-"));
const START = "2026-07-31";
const TODAY = "2026-11-27";

beforeEach(() => {
  const dbFile = path.join(tmpRoot, `${Math.random().toString(36).slice(2)}.db`);
  process.env.WHOOP_DB_PATH = dbFile;
  new Database(dbFile).close();
  const db = openWrite()!;
  db.prepare("INSERT OR IGNORE INTO users (id) VALUES (1), (2)").run();
  const rec = db.prepare("INSERT INTO recovery (user_id, date, recovery_score, hrv, rhr) VALUES (?, ?, ?, ?, ?)");
  const cyc = db.prepare("INSERT INTO cycles (user_id, date, strain) VALUES (?, ?, ?)");
  const slp = db.prepare(
    "INSERT INTO sleep (user_id, sleep_id, date, in_bed_ms, nap, start_local, end_local) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const wk = db.prepare("INSERT INTO workouts (user_id, id, date, sport, duration_sec, raw) VALUES (?, ?, ?, ?, ?, '{}')");
  // User 1: only 10 days of data; user 2: every day, plus a duplicate sleep.
  for (let i = 0; i < 30; i++) {
    const date = new Date(Date.UTC(2026, 9, 29 + i)).toISOString().slice(0, 10); // Oct 29 → Nov 27
    if (i < 10) {
      rec.run(1, date, 50, 60, 55);
      cyc.run(1, date, 8);
      slp.run(1, `u1-${i}`, date, 7 * 3_600_000, 0, `${date}T00:00:00`, `${date}T07:00:00`);
    }
    rec.run(2, date, 80, 90, 45);
    cyc.run(2, date, 15);
    slp.run(2, `u2-${i}`, date, 8 * 3_600_000, 0, `${date}T00:00:00`, `${date}T08:00:00`);
    wk.run(2, `w2-${i}`, date, "Running", 1800);
  }
  slp.run(2, "u2-dup", "2026-11-20", 3_600_000, 0, "2026-11-20T09:00:00", "2026-11-20T10:00:00");
  slp.run(2, "u2-nap", "2026-11-21", 1_800_000, 1, "2026-11-21T07:30:00", "2026-11-21T08:00:00");
  db.close();
  addSyncLog({
    user_id: 2, started_at: "2026-11-27T12:00:00Z", duration_ms: 100, status: "ok",
    recovery_count: 1, sleep_count: 1, workouts_count: 1, error_message: null, source: "manual", partial: false,
  });
});

afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

function healthFor(userId: number) {
  return buildDataHealth({
    today: TODAY,
    window: 30,
    recovery: getRecoveryRange(userId, START, TODAY),
    sleeps: getSleepRangeRaw(userId, START, TODAY),
    naps: getNaps(userId, START, TODAY),
    cycles: getStrainRange(userId, START, TODAY),
    workouts: getWorkoutRowsRange(userId, START, TODAY),
    syncLogs: getSyncLogs(userId),
  });
}

describe("data health over the existing user-scoped readers", () => {
  it("never mixes another tenant's rows, warnings or sync history", () => {
    const one = healthFor(1);
    const two = healthFor(2);
    const r1 = one.metrics.find((m) => m.key === "recovery")!;
    expect(r1.present).toBe(10);
    expect(one.metrics.find((m) => m.key === "workouts")!.present).toBe(0);
    expect(one.warnings).toEqual([]);
    expect(one.sync).toEqual([]);
    expect(one.latestDataDate).toBe("2026-11-07");

    expect(two.metrics.find((m) => m.key === "recovery")!.present).toBe(30);
    expect(two.warnings.map((w) => w.kind).sort()).toEqual(["duplicate-sleep", "overlap"]);
    expect(two.sync.map((s) => s.source)).toEqual(["manual"]);
  });
});
