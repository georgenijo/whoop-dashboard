import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Tenant isolation through the REAL user-scoped readers the /baselines page
// uses: two users share every date, and each sees only their own baselines.
const tmpRoot = mkdtempSync(path.join(tmpdir(), "baselines-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;
new Database(dbFile).close();

type Db = typeof import("@/lib/db");
type Lib = typeof import("./baselines");
let db: Db;
let lib: Lib;

const H = 3_600_000;
const TODAY = "2026-11-27";

function seed(userId: number, hrv: number, sleepH: number, strain: number) {
  const d = new Database(dbFile);
  try {
    d.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(userId);
    const endMs = Date.parse(`${TODAY}T00:00:00Z`);
    for (let i = 0; i < 20; i++) {
      const date = new Date(endMs - i * 86_400_000).toISOString().slice(0, 10);
      d.prepare(
        "INSERT INTO recovery (user_id, date, recovery_score, hrv, rhr, spo2, skin_temp) VALUES (?, ?, 50, ?, 50, NULL, 33.5)",
      ).run(userId, date, hrv);
      d.prepare(
        "INSERT INTO sleep (user_id, sleep_id, date, in_bed_ms, light_ms, deep_ms, rem_ms, performance, respiratory_rate, nap) VALUES (?, ?, ?, ?, ?, 0, 0, 90, 15, 0)",
      ).run(userId, `s-${userId}-${date}`, date, sleepH * H, sleepH * H);
      d.prepare("INSERT INTO cycles (user_id, date, strain) VALUES (?, ?, ?)").run(userId, date, strain);
    }
  } finally {
    d.close();
  }
}

function baselinesFor(userId: number) {
  const start = lib.baselineReadStart(TODAY, 30);
  return lib.computeBaselines(
    {
      recovery: db.getRecoveryRange(userId, start, TODAY),
      sleep: db.getSleepRange(userId, start, TODAY),
      cycles: db.getStrainRange(userId, start, TODAY),
    },
    TODAY,
    30,
  );
}

describe("baselines tenant isolation", () => {
  beforeAll(async () => {
    const connection = await import("@/lib/db/connection");
    connection.openWrite()?.close();
    db = await import("@/lib/db");
    lib = await import("./baselines");
    seed(1, 80, 8, 15);
    seed(2, 30, 5, 4);
  });

  afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it("each user's baselines reflect only their own rows", () => {
    const get = (r: ReturnType<typeof baselinesFor>, k: string) => r.metrics.find((m) => m.key === k)!;
    const a = baselinesFor(1);
    const b = baselinesFor(2);
    expect(get(a, "hrv").days).toBe(20);
    expect(get(a, "hrv").baseline).toBe(80);
    expect(get(a, "sleep_hours").baseline).toBe(8);
    expect(get(a, "strain").baseline).toBe(15);
    expect(get(a, "strain").days).toBe(19); // ends yesterday
    expect(get(b, "hrv").baseline).toBe(30);
    expect(get(b, "sleep_hours").baseline).toBe(5);
    expect(get(b, "strain").baseline).toBe(4);
  });

  it("an unknown user gets only building baselines", () => {
    const c = baselinesFor(3);
    expect(c.anyReady).toBe(false);
  });
});
