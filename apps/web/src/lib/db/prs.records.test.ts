// @vitest-environment node
// getRecordSeries (RECORDS_PAGE=1): tenant-scoped, same filters as the
// Overview PR queries, so /records and the Overview card agree.
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "prs-records-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;
new Database(dbFile).close();

import { openWrite } from "./connection";
import { getBestHRV, getLowestRHR, getRecordSeries } from "./prs";
import { buildRecordHistory } from "@/lib/analytics/records";

const A = 1;
const B = 2;
const EMPTY = 3;

beforeAll(() => {
  const w = openWrite();
  w!.close();
  const db = new Database(dbFile);
  for (const u of [A, B, EMPTY]) db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(u);
  const rec = db.prepare("INSERT INTO recovery (user_id, date, recovery_score, hrv, rhr) VALUES (?, ?, ?, ?, ?)");
  rec.run(A, "2026-11-01", 60, 70, 52);
  rec.run(A, "2026-11-02", null, 0, 0); // non-positive HRV/RHR ignored (like getBestHRV)
  rec.run(A, "2026-11-03", 91, 88, 48);
  rec.run(A, "2026-11-04", 40, 88, 48); // tie: most recent date wins
  rec.run(B, "2026-11-03", 99, 200, 30); // other tenant must never leak
  const cyc = db.prepare("INSERT INTO cycles (user_id, date, strain) VALUES (?, ?, ?)");
  cyc.run(A, "2026-11-01", 12.4);
  cyc.run(A, "2026-11-02", null);
  cyc.run(B, "2026-11-01", 21);
  const slp = db.prepare(
    "INSERT INTO sleep (user_id, sleep_id, date, in_bed_ms, light_ms, deep_ms, rem_ms, performance, nap) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  slp.run(A, "a1", "2026-11-03", 30_000_000, 10_000_000, 5_000_000, 6_000_000, 82, 0);
  slp.run(A, "a1-short", "2026-11-03", 3_000_000, 2_000_000, 0, 0, 99, 0); // deduped away
  slp.run(A, "a1-nap", "2026-11-03", 40_000_000, 30_000_000, 9_000_000, 1, 100, 1); // nap excluded
  slp.run(A, "a2", "2026-11-04", 1_000, null, null, null, null, 0); // unstaged → null
  slp.run(B, "b1", "2026-11-03", 40_000_000, 30_000_000, 5_000_000, 1, 100, 0);
  const wk = db.prepare("INSERT INTO workouts (user_id, id, date, sport, duration_sec, raw) VALUES (?, ?, ?, ?, ?, '{}')");
  wk.run(A, "w1", "2026-11-03", "Running", 1800);
  wk.run(A, "w2", "2026-11-03", "Cycling", 5400);
  wk.run(A, "w3", "2026-11-04", "Yoga", null);
  wk.run(B, "w4", "2026-11-03", "Rowing", 99_999);
  const steps = db.prepare("INSERT INTO daily_steps (user_id, date, steps, source) VALUES (?, ?, ?, 'apple_health')");
  steps.run(A, "2026-11-03", 14_200);
  steps.run(B, "2026-11-03", 50_000);
  db.close();
});

afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

describe("getRecordSeries", () => {
  it("returns only the user's own rows with PR filters applied", () => {
    const s = getRecordSeries(A);
    expect(s.hrv).toEqual([
      { date: "2026-11-01", value: 70 }, { date: "2026-11-02", value: null },
      { date: "2026-11-03", value: 88 }, { date: "2026-11-04", value: 88 },
    ]);
    expect(s.rhr.map((p) => p.value)).toEqual([52, null, 48, 48]);
    expect(s.recovery.map((p) => p.value)).toEqual([60, null, 91, 40]);
    expect(s.strain).toEqual([{ date: "2026-11-01", value: 12.4 }]);
    expect(s.sleepDuration).toEqual([{ date: "2026-11-03", value: 21_000_000 }, { date: "2026-11-04", value: null }]);
    expect(s.sleepPerformance.map((p) => p.value)).toEqual([82, null]);
    expect(s.workoutDuration.map((p) => [p.value, p.note])).toEqual([[1800, "Running"], [5400, "Cycling"]]);
    expect(s.steps).toEqual([{ date: "2026-11-03", value: 14_200 }]);
  });

  it("agrees with the Overview PR card on value and date (ties → latest date)", () => {
    const s = getRecordSeries(A);
    const hrv = buildRecordHistory(s.hrv, "max", { today: "2026-11-27" }).current!;
    const rhr = buildRecordHistory(s.rhr, "min", { today: "2026-11-27" }).current!;
    expect({ value: hrv.value, date: hrv.lastMatchedOn }).toEqual(getBestHRV(A));
    expect({ value: rhr.value, date: rhr.lastMatchedOn }).toEqual(getLowestRHR(A));
  });

  it("a user with no data gets empty series", () => {
    const s = getRecordSeries(EMPTY);
    for (const v of Object.values(s)) expect(v).toEqual([]);
  });
});
