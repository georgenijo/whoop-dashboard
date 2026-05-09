import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// WHOOP_DB_PATH must be set BEFORE importing any module that touches the DB —
// connection.ts reads it via dbPath() which lazy-creates the schema on first
// openWrite(). Same dance as src/lib/db/coach.test.ts.
const tmpRoot = mkdtempSync(path.join(tmpdir(), "dashboard-today-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;

// better-sqlite3 needs the file to exist (fileMustExist: true).
new Database(dbFile).close();

type RouteModule = typeof import("./route");
let route: RouteModule;

function db(): Database.Database {
  return new Database(dbFile);
}

function reset(): void {
  const d = db();
  try {
    d.prepare("DELETE FROM recovery").run();
    d.prepare("DELETE FROM sleep").run();
    d.prepare("DELETE FROM cycles").run();
  } finally {
    d.close();
  }
}

function insertRecovery(
  date: string,
  opts: {
    score?: number | null;
    hrv?: number | null;
    rhr?: number | null;
    spo2?: number | null;
    skin_temp?: number | null;
  } = {},
): void {
  const d = db();
  try {
    d.prepare(
      "INSERT OR REPLACE INTO recovery (date, recovery_score, hrv, rhr, spo2, skin_temp) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      date,
      opts.score ?? null,
      opts.hrv ?? null,
      opts.rhr ?? null,
      opts.spo2 ?? null,
      opts.skin_temp ?? null,
    );
  } finally {
    d.close();
  }
}

function insertSleep(
  date: string,
  opts: {
    in_bed_ms?: number | null;
    light_ms?: number | null;
    deep_ms?: number | null;
    rem_ms?: number | null;
    sleep_need_ms?: number | null;
    performance?: number | null;
    efficiency?: number | null;
    nap?: 0 | 1;
  } = {},
): void {
  const d = db();
  try {
    d.prepare(
      `INSERT OR REPLACE INTO sleep
        (date, in_bed_ms, light_ms, deep_ms, rem_ms, sleep_need_ms, performance, efficiency, nap)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      date,
      opts.in_bed_ms ?? null,
      opts.light_ms ?? null,
      opts.deep_ms ?? null,
      opts.rem_ms ?? null,
      opts.sleep_need_ms ?? null,
      opts.performance ?? null,
      opts.efficiency ?? null,
      opts.nap ?? 0,
    );
  } finally {
    d.close();
  }
}

function insertCycle(
  date: string,
  opts: {
    strain?: number | null;
    kilojoule?: number | null;
    avg_hr?: number | null;
    max_hr?: number | null;
  } = {},
): void {
  const d = db();
  try {
    d.prepare(
      "INSERT OR REPLACE INTO cycles (date, strain, kilojoule, avg_hr, max_hr) VALUES (?, ?, ?, ?, ?)",
    ).run(
      date,
      opts.strain ?? null,
      opts.kilojoule ?? null,
      opts.avg_hr ?? null,
      opts.max_hr ?? null,
    );
  } finally {
    d.close();
  }
}

function makeRequest(query?: string): Request {
  const url = `http://localhost/api/dashboard/today${query ? `?${query}` : ""}`;
  return new Request(url);
}

function todayUtc(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  // Force the route's auth path to fall through to the bootstrap user.
  process.env.NODE_ENV = "test";
  // Bootstrap the schema by writing once; better-sqlite3 file already exists.
  // We exploit the lazy CREATE TABLE in openWrite() by writing a no-op row.
  const d = db();
  try {
    // Seed a minimal user row required by other tables; openWrite() does this on
    // first call, but the route may not write at all — call openWrite via a
    // settings module to force schema bootstrap.
    d.close();
  } catch {
    // ignore
  }
  // Import any db-touching module to trigger openWrite() and create tables.
  await import("@/lib/db");
  // Importing alone doesn't open the DB. Force it via a settings write.
  const settings = await import("@/lib/db/settings");
  settings.setSetting("test_bootstrap", "1");

  route = await import("./route");
  reset();
});

beforeEach(() => {
  reset();
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/dashboard/today", () => {
  it("(a) returns the requested date when it has rows; is_fallback=false", async () => {
    const requested = "2026-05-09";
    insertRecovery(requested, { score: 72, hrv: 55, rhr: 50 });
    insertSleep(requested, {
      in_bed_ms: 8 * 60 * 60_000,
      light_ms: 3 * 60 * 60_000,
      deep_ms: 2 * 60 * 60_000,
      rem_ms: 2 * 60 * 60_000,
      sleep_need_ms: 8 * 60 * 60_000,
      performance: 90,
      efficiency: 92,
    });
    insertCycle(requested, { strain: 12, kilojoule: 8000, avg_hr: 70, max_hr: 150 });

    const res = await route.GET(makeRequest(`date=${requested}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.requested_date).toBe(requested);
    expect(body.data_date).toBe(requested);
    expect(body.is_fallback).toBe(false);
    expect(body.recovery).toMatchObject({ score: 72, hrv_ms: 55, rhr_bpm: 50 });
    expect(body.sleep).toMatchObject({ perf_pct: 90, efficiency_pct: 92 });
    expect(body.strain).toMatchObject({ score: 12, kj: 8000 });
  });

  it("(b) walks back to most recent day when requested_date is empty; is_fallback=true", async () => {
    const requested = "2026-05-09";
    const prior = "2026-05-08";
    insertRecovery(prior, { score: 65, hrv: 50, rhr: 52 });
    insertSleep(prior, {
      in_bed_ms: 7 * 60 * 60_000,
      light_ms: 2 * 60 * 60_000,
      deep_ms: 2 * 60 * 60_000,
      rem_ms: 2 * 60 * 60_000,
      sleep_need_ms: 8 * 60 * 60_000,
      performance: 80,
      efficiency: 88,
    });
    insertCycle(prior, { strain: 10 });

    const res = await route.GET(makeRequest(`date=${requested}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.requested_date).toBe(requested);
    expect(body.data_date).toBe(prior);
    expect(body.is_fallback).toBe(true);
    expect(body.recovery).toMatchObject({ score: 65 });
    expect(body.sleep).toMatchObject({ perf_pct: 80 });
    expect(body.strain).toMatchObject({ score: 10 });
  });

  it("(c) returns nulls when the entire 7-day lookback is empty; is_fallback=false", async () => {
    const requested = "2026-05-09";
    // Nothing inserted — DB has no rows in [requested-7d .. requested].

    const res = await route.GET(makeRequest(`date=${requested}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.requested_date).toBe(requested);
    expect(body.data_date).toBeNull();
    expect(body.is_fallback).toBe(false);
    expect(body.recovery).toBeNull();
    expect(body.sleep).toBeNull();
    expect(body.strain).toBeNull();
    expect(body.signals).toEqual({ ots: null, illness: null, apnea: null });
  });

  it("(d) defaults requested_date to localToday() when ?date= is omitted", async () => {
    const today = todayUtc();
    insertRecovery(today, { score: 80, hrv: 60, rhr: 48 });

    const res = await route.GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // localToday() reads server-local; UTC vs local can differ at day boundaries.
    // Accept either today's UTC date or that ±1 — what matters is the field is
    // non-null and ISO-shaped, and that data_date equals requested_date when the
    // server-local row exists (we inserted at UTC today as a best-effort match).
    expect(typeof body.requested_date).toBe("string");
    expect(body.requested_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (body.requested_date === today) {
      expect(body.data_date).toBe(today);
      expect(body.is_fallback).toBe(false);
    }
  });

  it("(e) rejects a malformed ?date= with HTTP 400", async () => {
    const res = await route.GET(makeRequest("date=garbage"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toMatch(/invalid date/i);
  });

  it("(f) computes signals anchored to data_date (not requested_date) when fallback fires", async () => {
    const requested = "2026-05-09";
    const dataDate = "2026-05-08"; // fallback target

    // OTS needs 7 joined days (recovery row WITH matching strain, plus hrv/rhr/score).
    // Build an 8-day strictly-decreasing-recovery, increasing-rhr, decreasing-hrv,
    // sustained-strain window ending on dataDate so all three OTS signals fire.
    const series: Array<{
      date: string;
      score: number;
      hrv: number;
      rhr: number;
      strain: number;
    }> = [];
    for (let i = 7; i >= 0; i--) {
      const d = shiftDate(dataDate, -i);
      // i=7 -> oldest, i=0 -> dataDate. recovery falls 90 -> 30 in steps of ~9.
      series.push({
        date: d,
        score: 90 - (7 - i) * 9,
        hrv: 70 - (7 - i) * 3,
        rhr: 48 + (7 - i),
        strain: 14 + (7 - i) * 0.1,
      });
    }
    for (const s of series) {
      insertRecovery(s.date, { score: s.score, hrv: s.hrv, rhr: s.rhr });
      insertCycle(s.date, { strain: s.strain });
    }
    // Sleep on dataDate so apnea anchor passes.
    insertSleep(dataDate, {
      in_bed_ms: 8 * 60 * 60_000,
      light_ms: 3 * 60 * 60_000,
      deep_ms: 2 * 60 * 60_000,
      rem_ms: 2 * 60 * 60_000,
      sleep_need_ms: 8 * 60 * 60_000,
      performance: 75,
      efficiency: 90,
    });

    const res = await route.GET(makeRequest(`date=${requested}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.requested_date).toBe(requested);
    expect(body.data_date).toBe(dataDate);
    expect(body.is_fallback).toBe(true);

    // OTS should be present and computed (not null) since signals anchor on dataDate.
    const signals = body.signals as Record<string, unknown>;
    expect(signals.ots).not.toBeNull();
    const ots = signals.ots as { score: number; severity: string };
    expect(typeof ots.score).toBe("number");
    expect(typeof ots.severity).toBe("string");
  });
});
