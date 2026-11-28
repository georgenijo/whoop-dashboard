// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { openWrite } from "./connection";
import { getStrainRange } from "./strain";
import { buildLoadSummary } from "@/lib/analytics/acwr";

const tmpRoot = mkdtempSync(path.join(tmpdir(), "whoop-training-load-"));

beforeEach(() => {
  const dbFile = path.join(tmpRoot, `${Math.random().toString(36).slice(2)}.db`);
  process.env.WHOOP_DB_PATH = dbFile;
  new Database(dbFile).close();
  const db = openWrite()!;
  db.prepare("INSERT OR IGNORE INTO users (id) VALUES (1), (2)").run();
  const ins = db.prepare("INSERT INTO cycles (user_id, date, strain) VALUES (?, ?, ?)");
  for (let i = 0; i < 40; i++) {
    const date = new Date(Date.UTC(2026, 9, 19 + i)).toISOString().slice(0, 10); // Oct 19 → Nov 27
    ins.run(1, date, 10);
    ins.run(2, date, 20); // another tenant, double the load
  }
  // User 2 spikes in the last week; must not leak into user 1's ratio.
  for (let i = 0; i < 7; i++) {
    const date = new Date(Date.UTC(2026, 10, 21 + i)).toISOString().slice(0, 10);
    db.prepare("UPDATE cycles SET strain = 21 WHERE user_id = 2 AND date = ?").run(date);
  }
  db.prepare("UPDATE cycles SET strain = NULL WHERE user_id = 1 AND date = '2026-11-24'").run();
  db.close();
});

afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

describe("training load over the existing user-scoped strain reader", () => {
  it("only sees the requesting user's cycles", () => {
    const rows = getStrainRange(1, "2026-08-09", "2026-11-27");
    expect(rows.every((r) => r.strain === null || r.strain === 10)).toBe(true);
    const s = buildLoadSummary(rows, "2026-11-27");
    expect(s.current.status).toBe("ok");
    expect(s.current.ratio).toBeCloseTo(1);
    expect(s.current.acuteDays).toBe(6); // the NULL day is a gap, not a zero

    const other = buildLoadSummary(getStrainRange(2, "2026-08-09", "2026-11-27"), "2026-11-27");
    expect(other.current.ratio!).toBeGreaterThan(1);
  });
});
