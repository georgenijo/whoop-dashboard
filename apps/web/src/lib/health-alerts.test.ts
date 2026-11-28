import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// End-to-end through the real user-scoped readers against a throwaway SQLite
// file (never the shared/production DB): seed two tenants, load alerts for
// one, and confirm the other's data never leaks in.
const tmpRoot = mkdtempSync(path.join(tmpdir(), "health-alerts-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;
new Database(dbFile).close();

function day(offset: number): string {
  const d = new Date(Date.UTC(2026, 10, 27 - offset));
  return d.toISOString().slice(0, 10);
}

function seed(userId: number, rhrFor: (i: number) => number, debtMin: number) {
  const db = new Database(dbFile);
  try {
    db.prepare("INSERT OR IGNORE INTO users (id, timezone) VALUES (?, 'America/New_York')").run(userId);
    const rec = db.prepare(
      "INSERT INTO recovery (user_id, date, recovery_score, hrv, rhr, spo2, skin_temp) VALUES (?, ?, ?, ?, ?, 96, ?)",
    );
    const cyc = db.prepare("INSERT INTO cycles (user_id, date, strain) VALUES (?, ?, ?)");
    const slp = db.prepare(
      "INSERT INTO sleep (user_id, sleep_id, date, in_bed_ms, light_ms, deep_ms, rem_ms, nap, respiratory_rate, need_from_debt_ms) VALUES (?, ?, ?, 28800000, 14400000, 3600000, 7200000, 0, ?, ?)",
    );
    for (let i = 44; i >= 0; i--) {
      const w = (i % 3) - 1;
      rec.run(userId, day(i), 65 + w * 4, 60 + w * 3, rhrFor(i), 33.5 + w * 0.1);
      cyc.run(userId, day(i), 7 + i * 0.2);
      slp.run(userId, `u${userId}-${i}`, day(i), 15 + w * 0.2, i === 0 ? debtMin * 60_000 : 600_000);
    }
  } finally {
    db.close();
  }
}

describe("loadHealthAlerts (real readers, temp DB)", () => {
  beforeAll(async () => {
    const connection = await import("@/lib/db/connection");
    connection.openWrite()?.close();
    seed(1, (i) => (i <= 2 ? 57 : 52 + ((i % 3) - 1) * 0.5), 100);
    seed(2, () => 90, 400); // another tenant with alarming numbers
    const db = new Database(dbFile);
    db.prepare(
      "INSERT INTO sync_logs (started_at, duration_ms, status, recovery_count, sleep_count, workouts_count, source, user_id) VALUES (?, 100, 'ok', 1, 1, 1, 'manual', 1)",
    ).run("2026-11-27T12:00:00.000Z");
    db.close();
  });

  afterAll(() => {
    vi.useRealTimers();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("evaluates only the requested user's rows, in the user's timezone", async () => {
    // 03:30 UTC on Nov 28 is still Nov 27 in New York — today must be Nov 27.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-28T03:30:00Z"));
    const { loadHealthAlerts } = await import("./health-alerts");
    const r = loadHealthAlerts(1);
    expect(r.asOf).toBe("2026-11-27");
    expect(r.checks.find((c) => c.kind === "freshness")?.status).toBe("clear");
    const rhr = r.alerts.find((a) => a.kind === "rhr_high");
    expect(rhr).toMatchObject({ severity: "watch", since: "2026-11-25", days: 3 });
    expect(rhr?.detail).toContain("Resting HR 57 bpm");
    expect(r.alerts.find((a) => a.kind === "sleep_debt")).toMatchObject({ severity: "watch", title: "Sleep debt 1 h 40 min" });
    // User 2's 90 bpm / 400-min debt must not appear.
    expect(JSON.stringify(r)).not.toContain("90 bpm");
    expect(JSON.stringify(r)).not.toContain("6 h 40 min");

    const other = loadHealthAlerts(2);
    expect(other.alerts.find((a) => a.kind === "sleep_debt")?.title).toBe("Sleep debt 6 h 40 min");
  });
});
