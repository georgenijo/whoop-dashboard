// @vitest-environment node
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// WHOOP_DB_PATH must be set before importing connection.ts (which the module
// under test loads transitively). Mirrors the pattern in coach.test.ts.
const tmpRoot = mkdtempSync(path.join(tmpdir(), "sync-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;
new Database(dbFile).close();

// Mock the whoop client. Each test sets `whoopGetMock` / `whoopGetAllMock`
// to control what the sync sees. We can't mock per-test because vi.mock is
// hoisted and module bindings are captured once.
const whoopGetMock = vi.fn();
const whoopGetAllMock = vi.fn();

vi.mock("@/lib/whoop/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/whoop/client")>(
    "@/lib/whoop/client",
  );
  return {
    ...actual,
    whoopGet: (...args: unknown[]) => whoopGetMock(...args),
    whoopGetAll: (...args: unknown[]) => whoopGetAllMock(...args),
  };
});

type SyncModule = typeof import("./sync");
let syncMod: SyncModule;

function recoveryRecord(date: string) {
  return {
    cycle_id: 1,
    sleep_id: `sleep-${date}`,
    score_state: "SCORED",
    created_at: `${date}T08:30:00.000Z`,
    score: {
      recovery_score: 70,
      hrv_rmssd_milli: 55,
      resting_heart_rate: 50,
      spo2_percentage: 97,
      skin_temp_celsius: 33.5,
    },
  };
}

function cycleRecord(date: string) {
  return {
    id: 1,
    start: `${date}T08:30:00.000Z`,
    end: `${date}T20:00:00.000Z`,
    score_state: "SCORED",
    score: {
      strain: 12.5,
      kilojoule: 8000,
      average_heart_rate: 70,
      max_heart_rate: 150,
    },
  };
}

function sleepRecord(date: string) {
  return {
    id: `sleep-${date}`,
    start: `${date}T01:00:00.000Z`,
    end: `${date}T08:00:00.000Z`,
    timezone_offset: "+00:00",
    nap: false,
    score_state: "SCORED",
    score: {
      sleep_performance_percentage: 90,
      sleep_efficiency_percentage: 92,
      sleep_consistency_percentage: 80,
      respiratory_rate: 14.5,
      stage_summary: {
        total_in_bed_time_milli: 28800000,
        total_light_sleep_time_milli: 14400000,
        total_slow_wave_sleep_time_milli: 5400000,
        total_rem_sleep_time_milli: 7200000,
        total_awake_time_milli: 1800000,
        disturbance_count: 3,
        sleep_cycle_count: 5,
      },
      sleep_needed: {
        baseline_milli: 28800000,
        need_from_sleep_debt_milli: 0,
        need_from_recent_strain_milli: 0,
        need_from_recent_nap_milli: 0,
      },
    },
  };
}

function workoutRecord(id: string, date: string) {
  return {
    id,
    start: `${date}T10:00:00.000Z`,
    end: `${date}T11:00:00.000Z`,
    sport_name: "Running",
    score_state: "SCORED",
    score: {
      average_heart_rate: 130,
      max_heart_rate: 170,
      strain: 8.5,
      kilojoule: 2000,
      distance_meter: 5000,
      zone_durations: {
        zone_zero_milli: 0,
        zone_one_milli: 600000,
        zone_two_milli: 1200000,
        zone_three_milli: 1200000,
        zone_four_milli: 600000,
        zone_five_milli: 0,
      },
    },
  };
}

function clearTables(): void {
  const db = new Database(dbFile);
  try {
    db.prepare("DELETE FROM recovery").run();
    db.prepare("DELETE FROM cycles").run();
    db.prepare("DELETE FROM sleep").run();
    db.prepare("DELETE FROM workouts").run();
    db.prepare("DELETE FROM daily_summary").run();
    db.prepare("DELETE FROM body_measurements").run();
  } finally {
    db.close();
  }
}

function rowCounts(): {
  recovery: number;
  cycles: number;
  sleep: number;
  workouts: number;
} {
  const db = new Database(dbFile);
  try {
    const r = (sql: string) =>
      (db.prepare(sql).get() as { c: number }).c;
    return {
      recovery: r("SELECT COUNT(*) AS c FROM recovery"),
      cycles: r("SELECT COUNT(*) AS c FROM cycles"),
      sleep: r("SELECT COUNT(*) AS c FROM sleep"),
      workouts: r("SELECT COUNT(*) AS c FROM workouts"),
    };
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  syncMod = await import("./sync");
  // First openWrite() lazy-creates the schema; trigger it before any test
  // tries to clear tables.
  const conn = await import("./db/connection");
  const db = conn.openWrite();
  db?.close();
});

beforeEach(() => {
  whoopGetMock.mockReset();
  whoopGetAllMock.mockReset();
  clearTables();
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function wireHappyPath() {
  // body
  whoopGetMock.mockImplementation(async () => ({
    height_meter: 1.8,
    weight_kilogram: 75,
    max_heart_rate: 195,
  }));
  // cycles / recovery / sleep / workouts — keyed by endpoint
  whoopGetAllMock.mockImplementation(async (endpoint: string) => {
    const date = "2025-04-12";
    if (endpoint === "/v2/cycle") {
      return { records: [cycleRecord(date)], pageCount: 1 };
    }
    if (endpoint === "/v2/recovery") {
      return { records: [recoveryRecord(date)], pageCount: 1 };
    }
    if (endpoint === "/v2/activity/sleep") {
      return { records: [sleepRecord(date)], pageCount: 1 };
    }
    if (endpoint === "/v2/activity/workout") {
      return { records: [workoutRecord("w-1", date)], pageCount: 1 };
    }
    return { records: [], pageCount: 1 };
  });
}

describe("runWhoopSync abort handling", () => {
  it("happy path: writes rows and returns success without partial flag", async () => {
    wireHappyPath();

    const result = await syncMod.runWhoopSync({});

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.partial).toBeUndefined();
    expect(result.rows_inserted).toEqual({
      recovery: 1,
      cycles: 1,
      sleep: 1,
      workouts: 1,
    });
    expect(rowCounts()).toEqual({ recovery: 1, cycles: 1, sleep: 1, workouts: 1 });
    expect(result.latest_recovery_date).toBe("2025-04-12");
  });

  it("abort BEFORE fetch: returns success=false and DB unchanged", async () => {
    wireHappyPath();
    const ctrl = new AbortController();
    ctrl.abort();

    const result = await syncMod.runWhoopSync({ signal: ctrl.signal });

    expect(result.success).toBe(false);
    expect(result.error).toBe("aborted");
    expect(result.partial).toBeUndefined();
    expect(rowCounts()).toEqual({ recovery: 0, cycles: 0, sleep: 0, workouts: 0 });
    // Whoop fetchers should not have been called.
    expect(whoopGetMock).not.toHaveBeenCalled();
    expect(whoopGetAllMock).not.toHaveBeenCalled();
  });

  it("abort DURING fetch: returns success=false and DB unchanged", async () => {
    const ctrl = new AbortController();

    whoopGetMock.mockImplementation(async () => {
      // Body fetch: pretend the upstream took long enough for an abort to
      // race in. Throw the canonical AbortError so the sync's catch block
      // routes through the abort branch.
      ctrl.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    whoopGetAllMock.mockImplementation(async () => {
      throw new DOMException("Aborted", "AbortError");
    });

    const result = await syncMod.runWhoopSync({ signal: ctrl.signal });

    expect(result.success).toBe(false);
    expect(result.error).toBe("aborted");
    expect(result.partial).toBeUndefined();
    expect(rowCounts()).toEqual({ recovery: 0, cycles: 0, sleep: 0, workouts: 0 });
  });

  it("abort AFTER commit, BEFORE return: returns success=true with partial=true and rows visible", async () => {
    wireHappyPath();

    // Custom signal whose `.aborted` getter only flips to true once enough
    // checkAborted calls have run for the SQLite transaction to commit.
    // sync.ts calls checkAborted() in this order:
    //   1. top of runWhoopSync (pre-fetch)
    //   2. after fetch, before persistAll
    //   3-7. five times inside persistAll's transaction body
    //   8. before upsertBodyMeasurement (post-commit)  <-- we want to fire here
    // We arm the signal on call #8 — the transaction has already committed
    // by then because better-sqlite3 transactions are synchronous.
    let calls = 0;
    const fakeSignal = {
      get aborted() {
        calls += 1;
        return calls >= 8;
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
      onabort: null,
      reason: undefined,
      throwIfAborted: () => {},
    } as unknown as AbortSignal;

    const result = await syncMod.runWhoopSync({ signal: fakeSignal });

    expect(result.success).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.rows_inserted).toEqual({
      recovery: 1,
      cycles: 1,
      sleep: 1,
      workouts: 1,
    });
    // Post-commit metadata work was skipped, so latest_*_date defaults to null.
    expect(result.latest_recovery_date).toBeNull();
    expect(result.latest_sleep_date).toBeNull();
    expect(result.latest_strain_date).toBeNull();
    // Rows are visible in the DB.
    expect(rowCounts()).toEqual({ recovery: 1, cycles: 1, sleep: 1, workouts: 1 });
  });
});
