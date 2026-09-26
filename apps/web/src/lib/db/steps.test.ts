// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { openWrite } from "./connection";
import {
  getLatestSteps,
  getPreviousSteps,
  getStepsRange,
  resolveStepsSource,
} from "./steps";
import {
  upsertWhoopCycleSteps,
  upsertCyclesAndRecompute,
  type WhoopCycleRecord,
} from "@/lib/whoop/upsert";

const tmpRoot = mkdtempSync(path.join(tmpdir(), "whoop-cycle-steps-"));
let dbFile: string;

beforeEach(() => {
  dbFile = path.join(tmpRoot, `${Math.random().toString(36).slice(2)}.db`);
  process.env.WHOOP_DB_PATH = dbFile;
  new Database(dbFile).close();
  const db = openWrite();
  expect(db).not.toBeNull();
  db!.prepare("INSERT OR IGNORE INTO users (id) VALUES (2)").run();
  db!.prepare(
    "INSERT INTO daily_steps (user_id, date, steps, source) VALUES (1, '2026-09-24', 7000, 'apple_health')",
  ).run();
  db!.close();
});

afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

function cycle(
  id: number,
  start: string,
  createdAt: string,
  steps: number | null,
  end?: string,
): WhoopCycleRecord {
  return {
    id,
    start,
    end,
    created_at: createdAt,
    updated_at: createdAt,
    score_state: "PENDING_SCORE",
    step_count: steps,
  };
}

describe("WHOOP cycle steps", () => {
  it("keeps null separate from zero and chooses one source globally", () => {
    const missing = cycle(101, "2026-09-24T04:22:00Z", "2026-09-24T12:00:00Z", null);
    expect(upsertWhoopCycleSteps(missing, 1, "America/New_York")).toBe(true);
    expect(resolveStepsSource(1)).toBe("apple_health");
    expect(getStepsRange(1, "2026-09-24", "2026-09-25", "whoop")).toEqual([]);

    const zero = cycle(102, "2026-09-25T02:09:00Z", "2026-09-25T10:36:00Z", 0);
    expect(upsertWhoopCycleSteps(zero, 1, "America/New_York")).toBe(true);
    expect(resolveStepsSource(1)).toBe("whoop");
    expect(getStepsRange(1, "2026-09-24", "2026-09-24")).toEqual([]);
    expect(getStepsRange(1, "2026-09-24", "2026-09-25")).toMatchObject([
      { date: "2026-09-25", steps: 0, source: "whoop", cycle_id: 102, cycle_end: null, is_partial: true },
    ]);
    expect(getLatestSteps(1)?.fetched_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z$/);
    expect(getStepsRange(1, "2026-09-24", "2026-09-25", "apple_health"))
      .toMatchObject([{ steps: 7000, source: "apple_health" }]);
    expect(getLatestSteps(1)?.cycle_id).toBe(102);
    expect(getPreviousSteps(1)).toBeNull();
    expect(getLatestSteps(1, "apple_health")?.steps).toBe(7000);
  });

  it("retains distinct cycles on one display date and never crosses tenants", () => {
    upsertWhoopCycleSteps(
      cycle(201, "2026-09-24T04:22:00Z", "2026-09-24T12:00:00Z", 4000),
      1, "America/New_York",
    );
    upsertWhoopCycleSteps(
      cycle(202, "2026-09-25T02:09:00Z", "2026-09-24T22:30:00Z", 900),
      1, "America/New_York",
    );
    upsertWhoopCycleSteps(
      cycle(203, "2026-09-25T02:09:00Z", "2026-09-25T10:36:00Z", 8000),
      2, "America/New_York",
    );
    const rows = getStepsRange(1, "2026-09-24", "2026-09-24", "whoop");
    expect(rows.map((r) => [r.cycle_id, r.steps])).toEqual([[201, 4000], [202, 900]]);
    expect(getStepsRange(2, "2026-09-24", "2026-09-25", "whoop"))
      .toMatchObject([{ cycle_id: 203, steps: 8000 }]);
    expect(getLatestSteps(1)?.cycle_id).toBe(202);
    expect(getPreviousSteps(1)?.cycle_id).toBe(201);
  });

  it("joins an existing write transaction and rolls back on failure", () => {
    const db = openWrite()!;
    expect(() => db.transaction(() => {
      upsertWhoopCycleSteps(
        cycle(301, "2026-09-25T02:09:00Z", "2026-09-25T10:36:00Z", 1234),
        1, "America/New_York", db,
      );
      throw new Error("abort");
    })()).toThrow("abort");
    db.close();
    expect(getStepsRange(1, "2026-09-25", "2026-09-25", "whoop")).toEqual([]);
  });

  it("persists unscored native steps in the cycle reconcile batch", () => {
    const pending = cycle(401, "2026-09-25T02:09:00Z", "2026-09-25T10:36:00Z", 2345);
    expect(upsertCyclesAndRecompute([pending], 1, "America/New_York")).toEqual([]);
    expect(getStepsRange(1, "2026-09-25", "2026-09-25", "whoop"))
      .toMatchObject([{ cycle_id: 401, steps: 2345, score_state: "PENDING_SCORE" }]);
  });

  it("reads a pre-migration DB without mutating it or querying a missing table", () => {
    const db = new Database(dbFile);
    db.exec("DROP TABLE whoop_cycle_steps");
    db.close();
    expect(resolveStepsSource(1)).toBe("apple_health");
    expect(getLatestSteps(1)?.steps).toBe(7000);
    expect(getStepsRange(1, "2026-09-24", "2026-09-24"))
      .toMatchObject([{ steps: 7000, source: "apple_health" }]);
    expect(getLatestSteps(1, "whoop")).toBeNull();
    expect(getPreviousSteps(1, "whoop")).toBeNull();
    expect(getStepsRange(1, "2026-09-24", "2026-09-24", "whoop")).toEqual([]);
    const check = new Database(dbFile, { readonly: true });
    expect(check.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'whoop_cycle_steps'",
    ).get()).toBeUndefined();
    check.close();
  });
});
