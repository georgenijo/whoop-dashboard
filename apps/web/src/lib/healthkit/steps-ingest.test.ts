// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "hk-steps-ingest-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;

beforeAll(async () => {
  new Database(dbFile).close();
  const conn = await import("@/lib/db/connection");
  conn.openWrite()?.close();
  const db = new Database(dbFile);
  db.prepare("INSERT OR IGNORE INTO users (id) VALUES (1)").run();
  db.close();
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("ingestHealthKitSteps", () => {
  it("upserts daily rows and is idempotent on replay", async () => {
    const { ingestHealthKitSteps } = await import("./steps-ingest");
    const { getStepsRange } = await import("@/lib/db/steps");

    const first = ingestHealthKitSteps(
      [
        { date: "2026-08-30", steps: 8420 },
        { date: "2026-08-31", steps: 1200 },
        { date: "bad-date", steps: 100 },
        { date: "2026-08-29", steps: -5 },
      ],
      1,
    );
    expect(first).toEqual({ upserted: 2, skipped: 2 });

    let rows = getStepsRange(1, "2026-08-29", "2026-08-31");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: "2026-08-30", steps: 8420, source: "apple_health" });

    const second = ingestHealthKitSteps([{ date: "2026-08-31", steps: 9100 }], 1);
    expect(second).toEqual({ upserted: 1, skipped: 0 });

    rows = getStepsRange(1, "2026-08-31", "2026-08-31");
    expect(rows[0]?.steps).toBe(9100);
  });
});
