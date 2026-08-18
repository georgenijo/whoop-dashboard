// @vitest-environment node
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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

// Default token mock: pre-warm returns a token without firing onRefresh.
// Specific tests override the implementation to simulate a refresh.
//
// `userId` is the new positional arg added in Phase C; the mock ignores it
// because the stub doesn't model per-user lookup — the test only cares that
// the sync correctly threads SOMETHING through.
const getValidAccessTokenMock = vi.fn<
  (
    userId: number,
    force?: boolean,
    hooks?: { onRefresh?: () => void },
  ) => Promise<string | null>
>(async () => "stub-token");

vi.mock("@/lib/whoop/token", () => ({
  getValidAccessToken: (
    userId: number,
    force?: boolean,
    hooks?: { onRefresh?: () => void },
  ) => getValidAccessTokenMock(userId, force, hooks),
}));

// Stub upsertBodyMeasurement so the partial-path test can hook abort into
// it (semantic trigger) without coupling to checkAborted call counts. Other
// tests don't assert on body upsert behavior, so the default no-op is fine.
const upsertBodyMock = vi.fn();
vi.mock("@/lib/whoop/upsert", async () => {
  const actual = await vi.importActual<typeof import("@/lib/whoop/upsert")>(
    "@/lib/whoop/upsert",
  );
  return { ...actual, upsertBodyMeasurement: (...args: unknown[]) => upsertBodyMock(...args) };
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
    // Clear all tenants — one test below seeds user_id=7 to exercise the
    // userId-plumbing path, and forward isolation between tests matters more
    // than fixture-shape parity with prod data.
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
  getValidAccessTokenMock.mockReset();
  upsertBodyMock.mockReset();
  // Default: token is fresh, no refresh fired.
  getValidAccessTokenMock.mockImplementation(async () => "stub-token");
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

    const result = await syncMod.runWhoopSync({ userId: 1 });

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

    const result = await syncMod.runWhoopSync({ userId: 1, signal: ctrl.signal });

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

    const result = await syncMod.runWhoopSync({ userId: 1, signal: ctrl.signal });

    expect(result.success).toBe(false);
    expect(result.error).toBe("aborted");
    expect(result.partial).toBeUndefined();
    expect(rowCounts()).toEqual({ recovery: 0, cycles: 0, sleep: 0, workouts: 0 });
  });

  it("abort AFTER commit, BEFORE body upsert: returns success=true with partial=true and rows visible", async () => {
    wireHappyPath();

    // Custom signal whose `.aborted` getter only flips to true once enough
    // checkAborted calls have run for the SQLite transaction to commit.
    // sync.ts calls checkAborted() in this order:
    //   1. top of runWhoopSync (pre-fetch)
    //   2. after fetch, before persistAll
    //   3-7. five times inside persistAll's transaction body
    //   8. immediately after persistAll, BEFORE the body-upsert try  <-- fire here
    //   9. after the body-upsert try, before latestDates
    // Firing on #8 means the abort surfaces OUTSIDE the body try, so it does
    // NOT get mislabeled as `body_error`. Body upsert never runs.
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

    const result = await syncMod.runWhoopSync({ userId: 1, signal: fakeSignal });

    expect(result.success).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.rows_inserted).toEqual({
      recovery: 1,
      cycles: 1,
      sleep: 1,
      workouts: 1,
    });
    // Abort surfaces outside the body try, so it is NOT mislabeled as a
    // body failure. Locks in WARN #1 from PR #250 review.
    expect(result.details.body_error).toBeUndefined();
    // latestDates() is a separate read open and isn't cancelled by the abort
    // signal — partial branch reads it, so the freshly-committed dates are
    // visible.
    expect(result.latest_recovery_date).toBe("2025-04-12");
    expect(result.latest_sleep_date).toBe("2025-04-12");
    expect(result.latest_strain_date).toBe("2025-04-12");
    // Rows are visible in the DB.
    expect(rowCounts()).toEqual({ recovery: 1, cycles: 1, sleep: 1, workouts: 1 });
  });

  it("onProgress: happy path emits expected stage set; upserting precedes computing_summary; no refreshing_token by default", async () => {
    wireHappyPath();
    const events: import("./sync").SyncProgressEvent[] = [];

    const result = await syncMod.runWhoopSync({
      userId: 1,
      onProgress: (e) => events.push(e),
    });

    expect(result.success).toBe(true);
    expect(result.partial).toBeUndefined();

    const stages = events.map((e) => e.stage);
    // Hard length check guards against double-emit regressions.
    expect(stages).toHaveLength(7);
    // Set equality guards against unexpected stage names slipping in.
    expect(new Set(stages)).toEqual(
      new Set([
        "fetching_recovery",
        "fetching_sleep",
        "fetching_strain",
        "fetching_workouts",
        "fetching_body",
        "upserting",
        "computing_summary",
      ]),
    );

    const idxUpsert = stages.indexOf("upserting");
    const idxSummary = stages.indexOf("computing_summary");
    expect(idxUpsert).toBeGreaterThan(-1);
    expect(idxSummary).toBeGreaterThan(idxUpsert);
    for (const fetchStage of [
      "fetching_recovery",
      "fetching_sleep",
      "fetching_strain",
      "fetching_workouts",
      "fetching_body",
    ] as const) {
      expect(stages.indexOf(fetchStage)).toBeLessThan(idxUpsert);
    }

    expect(stages).not.toContain("refreshing_token");
  });

  it("onProgress: refreshing_token fires before any fetching_* when pre-warm triggers a refresh", async () => {
    wireHappyPath();
    getValidAccessTokenMock.mockImplementation(async (_userId, _force, hooks) => {
      hooks?.onRefresh?.();
      return "stub-token";
    });

    const events: import("./sync").SyncProgressEvent[] = [];
    await syncMod.runWhoopSync({ userId: 1, onProgress: (e) => events.push(e) });

    const stages = events.map((e) => e.stage);
    const idxRefresh = stages.indexOf("refreshing_token");
    expect(idxRefresh).toBeGreaterThanOrEqual(0);
    for (const fetchStage of [
      "fetching_recovery",
      "fetching_sleep",
      "fetching_strain",
      "fetching_workouts",
      "fetching_body",
    ] as const) {
      const i = stages.indexOf(fetchStage);
      expect(i).toBeGreaterThan(idxRefresh);
    }
  });

  it("onProgress: abort-after-commit (partial path) does NOT emit computing_summary but DOES emit upserting", async () => {
    wireHappyPath();
    const ctrl = new AbortController();
    // Semantic trigger: abort the signal during the body upsert. The next
    // checkAborted (after body) trips → partial branch. No call-count
    // coupling to runWhoopSync internals.
    upsertBodyMock.mockImplementation(() => {
      ctrl.abort();
    });

    const events: import("./sync").SyncProgressEvent[] = [];
    const result = await syncMod.runWhoopSync({
      userId: 1,
      signal: ctrl.signal,
      onProgress: (e) => events.push(e),
    });

    expect(result.success).toBe(true);
    expect(result.partial).toBe(true);

    const stages = events.map((e) => e.stage);
    expect(stages).toContain("upserting");
    expect(stages).not.toContain("computing_summary");
  });

  it("non-abort exception AFTER commit: returns success=true with partial=true and error set", async () => {
    // Fetchers succeed and persistAll commits. Then we make latestDates()
    // throw on its first call by deleting the recovery table mid-flight via
    // a wrapped openWrite. Easiest: monkeypatch better-sqlite3 prepare on
    // the read open. Simpler still: trigger the body upsert with valid data
    // (no throw there), then poison latestDates by replacing the table just
    // before runWhoopSync calls it. We intercept via a fake signal whose
    // .aborted getter, on the post-body call (#9), drops the recovery table,
    // forcing latestDates' first prepare().get() to throw SQLITE_ERROR.
    wireHappyPath();
    let calls = 0;
    const fakeSignal = {
      get aborted() {
        calls += 1;
        if (calls === 9) {
          const db = new Database(dbFile);
          try {
            // Rename the column so the SELECT fails with "no such column".
            // (Dropping the table would lose the rows we want to keep
            // visible after the partial branch returns.)
            db.exec("ALTER TABLE recovery RENAME COLUMN date TO date_bak");
          } finally {
            db.close();
          }
        }
        return false;
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
      onabort: null,
      reason: undefined,
      throwIfAborted: () => {},
    } as unknown as AbortSignal;

    let result;
    try {
      result = await syncMod.runWhoopSync({ userId: 1, signal: fakeSignal });
    } finally {
      // Restore schema for any later tests / afterAll cleanup.
      const db = new Database(dbFile);
      try {
        const cols = db.prepare("PRAGMA table_info(recovery)").all() as {
          name: string;
        }[];
        if (cols.some((c) => c.name === "date_bak")) {
          db.exec("ALTER TABLE recovery RENAME COLUMN date_bak TO date");
        }
      } finally {
        db.close();
      }
    }

    expect(result.success).toBe(true);
    expect(result.partial).toBe(true);
    // The non-abort exception is surfaced via the error field.
    expect(result.error).toBeDefined();
    expect(result.rows_inserted).toEqual({
      recovery: 1,
      cycles: 1,
      sleep: 1,
      workouts: 1,
    });
    // latestDates() threw, so the partial branch falls back to null.
    expect(result.latest_recovery_date).toBeNull();
    expect(result.latest_sleep_date).toBeNull();
    expect(result.latest_strain_date).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cycles reconcile (issue #415)
// ---------------------------------------------------------------------------

function daysAgoDateStr(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function seedRecoveryOnly(userId: number, date: string): void {
  const db = new Database(dbFile);
  try {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(userId);
    db.prepare("INSERT INTO recovery (user_id, date) VALUES (?, ?)").run(
      userId,
      date,
    );
  } finally {
    db.close();
  }
}

function cycleCount(): number {
  const db = new Database(dbFile);
  try {
    return (
      db.prepare("SELECT COUNT(*) AS c FROM cycles").get() as { c: number }
    ).c;
  } finally {
    db.close();
  }
}

function dayStrain(userId: number, date: string): number | null {
  const db = new Database(dbFile);
  try {
    const row = db
      .prepare(
        "SELECT day_strain FROM daily_summary WHERE user_id = ? AND date = ?",
      )
      .get(userId, date) as { day_strain: number | null } | undefined;
    return row?.day_strain ?? null;
  } finally {
    db.close();
  }
}

/** The one-time historical backfill (#415) writes a per-user `app_settings`
 *  marker. Tests that exercise the routine reconcile pre-set it; tests that
 *  exercise the backfill itself clear it. */
function setBackfillMarker(userId: number, done: boolean): void {
  const db = new Database(dbFile);
  try {
    const key = `cycles_backfill_v1:user:${userId}`;
    if (done) {
      db.prepare(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(key, JSON.stringify({ completed_at: "2026-01-01T00:00:00.000Z" }));
    } else {
      db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
    }
  } finally {
    db.close();
  }
}

function backfillMarker(userId: number): string | null {
  const db = new Database(dbFile);
  try {
    const row = db
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get(`cycles_backfill_v1:user:${userId}`) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  } finally {
    db.close();
  }
}

function unscoredCycleRecord(date: string) {
  return {
    id: 99,
    start: `${date}T08:30:00.000Z`,
    end: `${date}T20:00:00.000Z`,
    score_state: "PENDING_SCORE",
  };
}

// Issue #440 review, WARN 2: a SCORED sleep record missing `end` makes
// `sleepSummaryDate` throw. Unguarded, that throw happens inside
// `persistAll`'s shared `db.transaction`, rolling back recovery, cycles,
// AND workouts for the whole sync window — not just the one bad sleep
// record. persistAll must catch it per-record, skip only that record, and
// surface a count.
describe("persistAll: a SCORED sleep record missing 'end' is skipped, not fatal (issue #440)", () => {
  it("skips the bad sleep record but still commits recovery, cycles, and workouts", async () => {
    const date = "2025-04-12";
    whoopGetMock.mockImplementation(async () => ({
      height_meter: 1.8,
      weight_kilogram: 75,
      max_heart_rate: 195,
    }));
    whoopGetAllMock.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/v2/cycle") return { records: [cycleRecord(date)], pageCount: 1 };
      if (endpoint === "/v2/recovery") return { records: [recoveryRecord(date)], pageCount: 1 };
      if (endpoint === "/v2/activity/sleep") {
        // SCORED but missing `end` — the malformed record under test.
        const bad = { ...sleepRecord(date), end: undefined };
        return { records: [bad], pageCount: 1 };
      }
      if (endpoint === "/v2/activity/workout") {
        return { records: [workoutRecord("w-1", date)], pageCount: 1 };
      }
      return { records: [], pageCount: 1 };
    });

    const result = await syncMod.runWhoopSync({ userId: 1 });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.partial).toBeUndefined();
    // The bad sleep record is skipped, not written...
    expect(result.rows_inserted).toEqual({
      recovery: 1,
      cycles: 1,
      sleep: 0,
      workouts: 1,
    });
    expect(result.details.sleep_missing_end_skipped).toBe(1);
    // ...but recovery, cycles, and workouts still commit — the whole sync
    // does NOT roll back over one malformed sleep record.
    expect(rowCounts()).toEqual({ recovery: 1, cycles: 1, sleep: 0, workouts: 1 });
  });

  it("reports zero skipped when every sleep record is well-formed", async () => {
    wireHappyPath();

    const result = await syncMod.runWhoopSync({ userId: 1 });

    expect(result.success).toBe(true);
    expect(result.details.sleep_missing_end_skipped).toBe(0);
  });
});

describe("reconcileCycles (issue #415)", () => {
  beforeEach(() => {
    // The look-back default is env-overridable, so pin it for every test in
    // this block: an empty value is falsy, so `defaultCyclesReconcileLookbackDays`
    // falls through to the built-in 30. Without this the suite fails on any
    // machine with CYCLES_RECONCILE_LOOKBACK_DAYS exported.
    vi.stubEnv("CYCLES_RECONCILE_LOOKBACK_DAYS", "");
    // Most tests here exercise the routine bounded reconcile; pretend the
    // one-time historical backfill already happened.
    setBackfillMarker(1, true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("nothing orphaned: makes zero Whoop API calls", async () => {
    const date = daysAgoDateStr(10);
    seedRecoveryOnly(1, date);
    const db = new Database(dbFile);
    try {
      db.prepare(
        "INSERT INTO cycles (user_id, date, strain) VALUES (?, ?, ?)",
      ).run(1, date, 10);
    } finally {
      db.close();
    }

    const result = await syncMod.reconcileCycles(1, "UTC");

    expect(result).toEqual({
      lookback_days: 30,
      orphans_found: 0,
      healed: 0,
      still_missing: 0,
      api_calls: 0,
    });
    expect(whoopGetAllMock).not.toHaveBeenCalled();
  });

  it("orphan found and now SCORED: heals it and recomputes daily_summary", async () => {
    const date = daysAgoDateStr(10);
    seedRecoveryOnly(1, date);
    whoopGetAllMock.mockImplementation(async (endpoint: string) => {
      expect(endpoint).toBe("/v2/cycle");
      return { records: [cycleRecord(date)], pageCount: 1 };
    });

    const result = await syncMod.reconcileCycles(1, "UTC");

    expect(result).toEqual({
      lookback_days: 30,
      orphans_found: 1,
      healed: 1,
      still_missing: 0,
      api_calls: 1,
    });
    expect(whoopGetAllMock).toHaveBeenCalledTimes(1);
    expect(cycleCount()).toBe(1);
    // The heal and its daily_summary recompute share one transaction — a
    // written cycles row must never leave day_strain NULL behind it.
    expect(dayStrain(1, date)).toBe(12.5);
  });

  it("reports api_calls as the number of upstream pages, not the number of fetches", async () => {
    const date = daysAgoDateStr(10);
    seedRecoveryOnly(1, date);
    whoopGetAllMock.mockImplementation(async () => ({
      records: [cycleRecord(date)],
      pageCount: 5,
    }));

    const result = await syncMod.reconcileCycles(1, "UTC");

    expect(result.api_calls).toBe(5);
  });

  it("orphan still unscored: writes nothing, doesn't throw, and doesn't loop", async () => {
    const date = daysAgoDateStr(10);
    seedRecoveryOnly(1, date);
    whoopGetAllMock.mockImplementation(async () => ({
      records: [unscoredCycleRecord(date)],
      pageCount: 1,
    }));

    const first = await syncMod.reconcileCycles(1, "UTC");
    expect(first).toEqual({
      lookback_days: 30,
      orphans_found: 1,
      healed: 0,
      still_missing: 1,
      api_calls: 1,
    });
    expect(cycleCount()).toBe(0);

    // Calling again re-checks from scratch (no persisted "attempted" state)
    // and produces the identical, bounded result — no throw, no runaway loop.
    const second = await syncMod.reconcileCycles(1, "UTC");
    expect(second).toEqual(first);
    expect(cycleCount()).toBe(0);
  });

  it("excludes today's date — the current cycle is expected to be unscored", async () => {
    seedRecoveryOnly(1, daysAgoDateStr(0));

    const result = await syncMod.reconcileCycles(1, "UTC");

    expect(result.orphans_found).toBe(0);
    expect(whoopGetAllMock).not.toHaveBeenCalled();
  });

  it("skipRecentDays excludes dates the caller's own fetch just covered", async () => {
    // Yesterday's cycle routinely has no score yet — it closes at the next
    // sleep onset. It is inside every 7-day sync window, so `persistAll` will
    // write it the moment it scores; reporting it as an orphan and re-fetching
    // it is a guaranteed-empty round trip that also poisons still_missing.
    seedRecoveryOnly(1, daysAgoDateStr(1));
    seedRecoveryOnly(1, daysAgoDateStr(3));

    const skipped = await syncMod.reconcileCycles(1, "UTC", {
      skipRecentDays: 7,
    });
    expect(skipped.orphans_found).toBe(0);
    expect(whoopGetAllMock).not.toHaveBeenCalled();

    // Same DB state, default skip (today only) — proves the dates are really
    // there and it's `skipRecentDays` doing the excluding.
    whoopGetAllMock.mockImplementation(async () => ({
      records: [],
      pageCount: 1,
    }));
    const notSkipped = await syncMod.reconcileCycles(1, "UTC");
    expect(notSkipped.orphans_found).toBe(2);
  });

  it("respects a non-default lookbackDays in both directions", async () => {
    const date = daysAgoDateStr(45);
    seedRecoveryOnly(1, date);

    // Outside the 30-day default.
    const narrow = await syncMod.reconcileCycles(1, "UTC");
    expect(narrow.lookback_days).toBe(30);
    expect(narrow.orphans_found).toBe(0);
    expect(whoopGetAllMock).not.toHaveBeenCalled();

    // Widened past it — the same orphan is now found. This is the assertion
    // the previous version of this test lacked: it passed `21`, the default,
    // so it would have passed identically had `opts.lookbackDays` been ignored.
    whoopGetAllMock.mockImplementation(async () => ({
      records: [cycleRecord(date)],
      pageCount: 1,
    }));
    const wide = await syncMod.reconcileCycles(1, "UTC", { lookbackDays: 60 });
    expect(wide.lookback_days).toBe(60);
    expect(wide.orphans_found).toBe(1);
    expect(wide.healed).toBe(1);
  });

  it("reads the default look-back from CYCLES_RECONCILE_LOOKBACK_DAYS", async () => {
    const date = daysAgoDateStr(45);
    seedRecoveryOnly(1, date);
    whoopGetAllMock.mockImplementation(async () => ({
      records: [cycleRecord(date)],
      pageCount: 1,
    }));

    vi.stubEnv("CYCLES_RECONCILE_LOOKBACK_DAYS", "60");
    const result = await syncMod.reconcileCycles(1, "UTC");

    expect(result.lookback_days).toBe(60);
    expect(result.orphans_found).toBe(1);
    expect(result.healed).toBe(1);
  });

  it("ignores a non-numeric or non-positive CYCLES_RECONCILE_LOOKBACK_DAYS", async () => {
    for (const bad of ["not-a-number", "0", "-5"]) {
      vi.stubEnv("CYCLES_RECONCILE_LOOKBACK_DAYS", bad);
      const result = await syncMod.reconcileCycles(1, "UTC");
      expect(result.lookback_days).toBe(30);
    }
  });
});

describe("cycles historical backfill (issue #415)", () => {
  beforeEach(() => {
    vi.stubEnv("CYCLES_RECONCILE_LOOKBACK_DAYS", "");
    setBackfillMarker(1, false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("heals orphans older than the routine look-back, then never runs again", async () => {
    const date = daysAgoDateStr(120);
    seedRecoveryOnly(1, date);
    whoopGetAllMock.mockImplementation(async () => ({
      records: [cycleRecord(date)],
      pageCount: 1,
    }));

    // Well outside the 30-day routine band — the routine pass can't see it.
    const routine = await syncMod.reconcileCycles(1, "UTC");
    expect(routine.orphans_found).toBe(0);

    const first = await syncMod.backfillOrphanedCyclesOnce(1, "UTC");
    expect(first).toEqual({
      lookback_days: 0,
      orphans_found: 1,
      healed: 1,
      still_missing: 0,
      api_calls: 1,
    });
    expect(cycleCount()).toBe(1);
    expect(dayStrain(1, date)).toBe(12.5);
    expect(backfillMarker(1)).toContain("completed_at");

    // Marker present → no scan, no fetch, no result.
    whoopGetAllMock.mockClear();
    const second = await syncMod.backfillOrphanedCyclesOnce(1, "UTC");
    expect(second).toBeNull();
    expect(whoopGetAllMock).not.toHaveBeenCalled();
  });

  it("marks itself complete even when some orphans are still unscored upstream", async () => {
    const date = daysAgoDateStr(120);
    seedRecoveryOnly(1, date);
    whoopGetAllMock.mockImplementation(async () => ({
      records: [unscoredCycleRecord(date)],
      pageCount: 1,
    }));

    const first = await syncMod.backfillOrphanedCyclesOnce(1, "UTC");
    expect(first).toMatchObject({ orphans_found: 1, healed: 0, still_missing: 1 });
    // Dates Whoop has no scored cycle for will never become scored by asking
    // again every sync — don't re-run the wide scan forever.
    expect(await syncMod.backfillOrphanedCyclesOnce(1, "UTC")).toBeNull();
  });

  it("retries on the next sync if the pass threw", async () => {
    seedRecoveryOnly(1, daysAgoDateStr(120));
    whoopGetAllMock.mockImplementation(async () => {
      throw new Error("upstream 503");
    });

    await expect(
      syncMod.backfillOrphanedCyclesOnce(1, "UTC"),
    ).rejects.toThrow("upstream 503");
    expect(backfillMarker(1)).toBeNull();
  });

  it("chunks the fetch so no single query exceeds Whoop's range cap", async () => {
    // Two orphans 200 days apart: one 90-day-capped chunk each, and the ~200
    // days of healthy history between them is never fetched at all.
    const older = daysAgoDateStr(260);
    const newer = daysAgoDateStr(60);
    seedRecoveryOnly(1, older);
    seedRecoveryOnly(1, newer);
    whoopGetAllMock.mockImplementation(async () => ({
      records: [],
      pageCount: 1,
    }));

    const result = await syncMod.backfillOrphanedCyclesOnce(1, "UTC");

    expect(result).toMatchObject({ orphans_found: 2, still_missing: 2 });
    expect(whoopGetAllMock).toHaveBeenCalledTimes(2);
    for (const call of whoopGetAllMock.mock.calls) {
      const { start, end } = call[1] as { start: string; end: string };
      const spanDays =
        (Date.parse(end) - Date.parse(start)) / 86_400_000;
      expect(spanDays).toBeLessThanOrEqual(180);
    }
  });

  it("is scoped per user — one user's marker doesn't suppress another's backfill", async () => {
    const date = daysAgoDateStr(120);
    seedRecoveryOnly(1, date);
    seedRecoveryOnly(7, date);
    whoopGetAllMock.mockImplementation(async () => ({
      records: [],
      pageCount: 1,
    }));

    expect(await syncMod.backfillOrphanedCyclesOnce(1, "UTC")).not.toBeNull();
    expect(await syncMod.backfillOrphanedCyclesOnce(1, "UTC")).toBeNull();
    expect(await syncMod.backfillOrphanedCyclesOnce(7, "UTC")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sleep wake-day re-date backfill (issue #440)
// ---------------------------------------------------------------------------

function seedSleepRow(
  userId: number,
  sleepId: string,
  date: string,
  raw: string | null,
  opts: {
    inBedMs?: number;
    lightMs?: number;
    deepMs?: number;
    remMs?: number;
    nap?: number;
  } = {},
): void {
  const db = new Database(dbFile);
  try {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(userId);
    db.prepare(
      "INSERT INTO sleep (user_id, sleep_id, date, in_bed_ms, light_ms, deep_ms, rem_ms, nap, raw) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      userId,
      sleepId,
      date,
      opts.inBedMs ?? 28_800_000,
      opts.lightMs ?? 14_400_000,
      opts.deepMs ?? 5_400_000,
      opts.remMs ?? 7_200_000,
      opts.nap ?? 0,
      raw,
    );
  } finally {
    db.close();
  }
}

/**
 * Seeds a `sleep` row for a `userId` that has NO matching `users` row —
 * deliberately, to manufacture a genuine (unmocked) transaction failure.
 * `daily_summary` and `sleep` both have `user_id INTEGER ... REFERENCES
 * users(id)`; `openWrite()` turns `foreign_keys = ON`, so an `INSERT OR
 * REPLACE INTO daily_summary` for this user_id inside the backfill's
 * transaction throws a real `FOREIGN KEY constraint failed` — no mocking of
 * `recomputeDailySummary` or the DB layer required. This raw connection
 * (unlike `openWrite()`) never sets `foreign_keys = ON`, so the seed insert
 * itself succeeds despite the dangling reference.
 */
function seedSleepRowNoUser(
  userId: number,
  sleepId: string,
  date: string,
  raw: string | null,
): void {
  const db = new Database(dbFile);
  try {
    // This build's default differs from vanilla SQLite — be explicit rather
    // than relying on the connection default.
    db.pragma("foreign_keys = OFF");
    db.prepare(
      "INSERT INTO sleep (user_id, sleep_id, date, in_bed_ms, light_ms, deep_ms, rem_ms, nap, raw) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
    ).run(userId, sleepId, date, 28_800_000, 14_400_000, 5_400_000, 7_200_000, raw);
  } finally {
    db.close();
  }
}

function sleepDateFor(userId: number, sleepId: string): string | null {
  const db = new Database(dbFile);
  try {
    const row = db
      .prepare("SELECT date FROM sleep WHERE user_id = ? AND sleep_id = ?")
      .get(userId, sleepId) as { date: string } | undefined;
    return row?.date ?? null;
  } finally {
    db.close();
  }
}

function seedDailySummarySleepHours(
  userId: number,
  date: string,
  sleepHours: number | null,
): void {
  const db = new Database(dbFile);
  try {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(userId);
    db.prepare(
      "INSERT INTO daily_summary (user_id, date, sleep_hours) VALUES (?, ?, ?) " +
        "ON CONFLICT(user_id, date) DO UPDATE SET sleep_hours = excluded.sleep_hours",
    ).run(userId, date, sleepHours);
  } finally {
    db.close();
  }
}

function dailySummarySleepHours(userId: number, date: string): number | null {
  const db = new Database(dbFile);
  try {
    const row = db
      .prepare("SELECT sleep_hours FROM daily_summary WHERE user_id = ? AND date = ?")
      .get(userId, date) as { sleep_hours: number | null } | undefined;
    return row?.sleep_hours ?? null;
  } finally {
    db.close();
  }
}

function sleepBackfillMarker(userId: number): string | null {
  const db = new Database(dbFile);
  try {
    const row = db
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get(`sleep_wake_day_v1:user:${userId}`) as { value: string } | undefined;
    return row?.value ?? null;
  } finally {
    db.close();
  }
}

function clearSleepBackfillMarkers(): void {
  const db = new Database(dbFile);
  try {
    db.prepare("DELETE FROM app_settings WHERE key LIKE 'sleep_wake_day_v1:%'").run();
  } finally {
    db.close();
  }
}

describe("sleep wake-day backfill (issue #440)", () => {
  beforeEach(() => {
    // `beforeEach` at the top of the file clears the domain tables but not
    // `app_settings` — without this, a marker set by an earlier test in this
    // suite would make every subsequent `backfillSleepWakeDayOnce` call here
    // (and in the wiring describe block below) a no-op.
    clearSleepBackfillMarkers();
  });

  it("re-dates rows whose raw.end lands on a different day than the stored date", () => {
    // Started 23:11 on the 28th, ended 08:38 on the 29th — pre-fix data
    // filed it on the 28th (start day).
    seedSleepRow(
      1,
      "sleep-a",
      "2026-04-28",
      JSON.stringify({ id: "sleep-a", start: "2026-04-28T23:11:23.000Z", end: "2026-04-29T08:38:56.000Z" }),
    );
    // Already correctly dated — start and end share a calendar day.
    seedSleepRow(
      1,
      "sleep-b",
      "2026-04-28",
      JSON.stringify({ id: "sleep-b", start: "2026-04-28T01:55:13.000Z", end: "2026-04-28T08:42:14.000Z" }),
    );

    const result = syncMod.backfillSleepWakeDayOnce(1, "UTC");

    expect(result).toMatchObject({ rows_scanned: 2, rows_changed: 1, rows_skipped: 0 });
    expect(sleepDateFor(1, "sleep-a")).toBe("2026-04-29");
    expect(sleepDateFor(1, "sleep-b")).toBe("2026-04-28");
    expect(sleepBackfillMarker(1)).toContain("completed_at");
  });

  it("is idempotent — the second run is a no-op because the marker is set", () => {
    seedSleepRow(
      1,
      "sleep-a",
      "2026-04-28",
      JSON.stringify({ id: "sleep-a", end: "2026-04-29T08:38:56.000Z" }),
    );

    const first = syncMod.backfillSleepWakeDayOnce(1, "UTC");
    expect(first?.rows_changed).toBe(1);
    expect(sleepDateFor(1, "sleep-a")).toBe("2026-04-29");

    // Marker present → no scan, and re-dating is not attempted again even if
    // (hypothetically) something re-wrote the wrong date back.
    const second = syncMod.backfillSleepWakeDayOnce(1, "UTC");
    expect(second).toBeNull();
    expect(sleepDateFor(1, "sleep-a")).toBe("2026-04-29");
  });

  it("sets the marker even when zero sleep rows exist (safe on a fresh DB)", () => {
    const result = syncMod.backfillSleepWakeDayOnce(1, "UTC");
    expect(result).toEqual({
      rows_scanned: 0,
      rows_changed: 0,
      rows_skipped: 0,
      dates_recomputed: 0,
      collisions: 0,
    });
    expect(sleepBackfillMarker(1)).toContain("completed_at");
  });

  it("skips a row with unparseable raw instead of throwing, and still processes the rest", () => {
    seedSleepRow(1, "sleep-bad", "2026-04-28", "not json at all");
    seedSleepRow(
      1,
      "sleep-good",
      "2026-04-28",
      JSON.stringify({ id: "sleep-good", end: "2026-04-29T08:38:56.000Z" }),
    );

    const result = syncMod.backfillSleepWakeDayOnce(1, "UTC");

    expect(result).toMatchObject({ rows_scanned: 2, rows_changed: 1, rows_skipped: 1 });
    expect(sleepDateFor(1, "sleep-bad")).toBe("2026-04-28"); // untouched
    expect(sleepDateFor(1, "sleep-good")).toBe("2026-04-29");
  });

  it("skips a row whose raw is present but lacks .end", () => {
    seedSleepRow(1, "sleep-no-end", "2026-04-28", JSON.stringify({ id: "sleep-no-end" }));

    const result = syncMod.backfillSleepWakeDayOnce(1, "UTC");

    expect(result).toMatchObject({ rows_scanned: 1, rows_changed: 0, rows_skipped: 1 });
    expect(sleepDateFor(1, "sleep-no-end")).toBe("2026-04-28");
  });

  it("skips a row with NULL raw", () => {
    seedSleepRow(1, "sleep-null-raw", "2026-04-28", null);

    const result = syncMod.backfillSleepWakeDayOnce(1, "UTC");

    expect(result).toMatchObject({ rows_scanned: 1, rows_changed: 0, rows_skipped: 1 });
  });

  it("recomputes daily_summary for both the vacated and the destination date", () => {
    const wrongDate = "2026-04-28";
    const rightDate = "2026-04-29";
    // (light+deep+rem)/3600000 = (14.4M + 5.4M + 7.2M) / 3.6M = 7.5h.
    seedSleepRow(
      1,
      "sleep-a",
      wrongDate,
      JSON.stringify({ id: "sleep-a", end: `${rightDate}T08:38:56.000Z` }),
      { lightMs: 14_400_000, deepMs: 5_400_000, remMs: 7_200_000 },
    );
    // Pre-fix daily_summary state: the wrong date carries this sleep's hours.
    seedDailySummarySleepHours(1, wrongDate, 7.5);

    const result = syncMod.backfillSleepWakeDayOnce(1, "UTC");

    expect(result).toMatchObject({ rows_changed: 1, dates_recomputed: 2 });
    // Vacated date: no sleep row matches it anymore — recomputed to NULL,
    // not left stale at 7.5.
    expect(dailySummarySleepHours(1, wrongDate)).toBeNull();
    // Destination date: recomputed to reflect the row that moved onto it.
    expect(dailySummarySleepHours(1, rightDate)).toBe(7.5);
  });

  it("is scoped per user — one user's marker doesn't suppress another's backfill", () => {
    seedSleepRow(
      1,
      "sleep-a",
      "2026-04-28",
      JSON.stringify({ id: "sleep-a", end: "2026-04-29T08:38:56.000Z" }),
    );
    seedSleepRow(
      7,
      "sleep-b",
      "2026-04-28",
      JSON.stringify({ id: "sleep-b", end: "2026-04-29T08:38:56.000Z" }),
    );

    expect(syncMod.backfillSleepWakeDayOnce(1, "UTC")).not.toBeNull();
    expect(syncMod.backfillSleepWakeDayOnce(1, "UTC")).toBeNull();
    expect(syncMod.backfillSleepWakeDayOnce(7, "UTC")).not.toBeNull();
  });

  // Issue #440 review, WARN 1: prod pre-measurement said 0 collisions, but a
  // one-shot irreversible migration of a dataset with no other backup must
  // count and log the real post-migration number rather than trust that.
  it("counts a collision when re-dating leaves two non-nap sleeps on the same date", () => {
    // A legitimate double-sleep night: wake ~03:00, sleep again, wake
    // ~09:00 — both re-date onto 2026-04-29.
    seedSleepRow(
      1,
      "sleep-a",
      "2026-04-28",
      JSON.stringify({ id: "sleep-a", end: "2026-04-29T03:00:00.000Z" }),
    );
    seedSleepRow(
      1,
      "sleep-b",
      "2026-04-28",
      JSON.stringify({ id: "sleep-b", end: "2026-04-29T09:00:00.000Z" }),
    );

    const result = syncMod.backfillSleepWakeDayOnce(1, "UTC");

    expect(result).toMatchObject({ rows_changed: 2, collisions: 1 });
    // Not data loss — both rows still exist under their own sleep_id.
    expect(sleepDateFor(1, "sleep-a")).toBe("2026-04-29");
    expect(sleepDateFor(1, "sleep-b")).toBe("2026-04-29");
  });

  it("does not count a nap sharing a date with a re-dated night sleep as a collision", () => {
    seedSleepRow(
      1,
      "sleep-night",
      "2026-04-28",
      JSON.stringify({ id: "sleep-night", end: "2026-04-29T08:38:56.000Z" }),
    );
    seedSleepRow(
      1,
      "nap-1",
      "2026-04-29",
      JSON.stringify({ id: "nap-1", end: "2026-04-29T15:00:00.000Z" }),
      { nap: 1 },
    );

    const result = syncMod.backfillSleepWakeDayOnce(1, "UTC");

    expect(result?.collisions).toBe(0);
  });

  // Issue #440 review, BLOCK 4: a one-shot migration must fail CLOSED —
  // never mark itself complete having scanned zero rows just because the DB
  // was momentarily unavailable.
  it("fails closed: throws and writes no marker when the DB is unavailable", () => {
    vi.stubEnv("WHOOP_DB_PATH", "/nonexistent/dir/whoop-missing.db");
    try {
      expect(() => syncMod.backfillSleepWakeDayOnce(1, "UTC")).toThrow(
        /DB unavailable/,
      );
    } finally {
      vi.unstubAllEnvs();
    }
    // The real DB (restored above) was never touched by the branch above,
    // so its marker is still absent — confirming no marker leaked through.
    expect(sleepBackfillMarker(1)).toBeNull();
  });

  // Issue #440 review, second pass, BLOCK: a prior version of this function
  // ran the re-date UPDATEs in their own transaction and the recomputes
  // afterward via separate `recomputeDailySummary()` calls. Once the
  // UPDATE transaction committed, every row satisfied
  // `date === parseDate(raw.end)`, so a retry after a recompute failure
  // found `changes` empty and wrote the "complete" marker with
  // `dates_recomputed: 0` — permanently stale `daily_summary`, falsely
  // marked done. The fix folds the UPDATEs and the recomputes into ONE
  // transaction: this test forces a REAL (unmocked) mid-transaction failure
  // via a dangling `user_id` FK reference and asserts the UPDATE itself
  // rolled back too, so a retry after fixing the underlying problem sees
  // the original pre-migration state and genuinely succeeds.
  it("rolls back the re-date UPDATE too when the recompute half of the transaction fails", () => {
    const noUserId = 4242; // deliberately has no `users` row — see helper doc.
    seedSleepRowNoUser(
      noUserId,
      "sleep-a",
      "2026-04-28",
      JSON.stringify({ id: "sleep-a", end: "2026-04-29T08:38:56.000Z" }),
    );

    expect(() => syncMod.backfillSleepWakeDayOnce(noUserId, "UTC")).toThrow(
      /FOREIGN KEY constraint failed/,
    );

    // Nothing committed — not the daily_summary recompute, and NOT the
    // sleep row's date UPDATE either. A split-transaction implementation
    // would have left this at 2026-04-29 (UPDATE committed on its own),
    // which is exactly what makes a retry blind: this row would already
    // look "correct" even though the marker was never set.
    expect(sleepDateFor(noUserId, "sleep-a")).toBe("2026-04-28");
    expect(sleepBackfillMarker(noUserId)).toBeNull();

    // Fix the underlying problem and retry — a genuine second attempt
    // against the ORIGINAL pre-migration state, not a no-op.
    const usersDb = new Database(dbFile);
    try {
      usersDb.prepare("INSERT INTO users (id) VALUES (?)").run(noUserId);
    } finally {
      usersDb.close();
    }

    const retry = syncMod.backfillSleepWakeDayOnce(noUserId, "UTC");

    expect(retry).toMatchObject({ rows_changed: 1, dates_recomputed: 2 });
    expect(sleepDateFor(noUserId, "sleep-a")).toBe("2026-04-29");
    expect(sleepBackfillMarker(noUserId)).toContain("completed_at");
  });
});

describe("runWhoopSync + sleep backfill wiring (issue #440)", () => {
  beforeEach(() => {
    clearSleepBackfillMarkers();
  });

  it("runs the one-time backfill on first sync and is absent on the next", async () => {
    wireHappyPath();

    const first = await syncMod.runWhoopSync({ userId: 1 });
    expect(first.success).toBe(true);
    expect(first.details.sleep_backfill).toBeDefined();

    const second = await syncMod.runWhoopSync({ userId: 1 });
    expect(second.success).toBe(true);
    expect(second.details.sleep_backfill).toBeUndefined();
  });

  // Issue #440 review, WARN 1: the ordering fix (backfill runs BEFORE
  // persistAll) had zero direct coverage — every existing wiring test seeds
  // its legacy row on a date far outside wireHappyPath's fetch window, so
  // it passes whether the backfill runs before OR after persistAll. This
  // pins the actual regression: a legacy sleep_id that the sync's OWN fetch
  // window also returns.
  it("recomputes the vacated date for a legacy row whose sleep_id is ALSO in this sync's fetch window", async () => {
    // wireHappyPath's sleep fixture is sleep_id "sleep-2025-04-12", dated
    // 2025-04-12 (start and end share that day). Seed a pre-existing row
    // under the SAME sleep_id but the WRONG (pre-migration) date —
    // representing a night that had already been corrected by nothing yet.
    // If persistAll runs first, its INSERT OR REPLACE silently overwrites
    // both `date` and `raw` to the fetched record's (already-correct)
    // values BEFORE the backfill ever scans the table — the backfill would
    // then see `date === parseDate(raw.end)` already true, record zero
    // changes, and never recompute the date this row vacated.
    seedSleepRow(
      1,
      "sleep-2025-04-12",
      "2025-04-11",
      JSON.stringify({ id: "sleep-2025-04-12", end: "2025-04-12T08:00:00.000Z" }),
    );
    // Pre-existing daily_summary for the date this row is really parked on
    // (wrong, pre-migration) — must be recomputed to NULL, not left stale.
    seedDailySummarySleepHours(1, "2025-04-11", 7.5);
    wireHappyPath();

    const result = await syncMod.runWhoopSync({ userId: 1 });

    expect(result.success).toBe(true);
    // Correct ordering: the backfill saw the row BEFORE persistAll touched
    // it, so it counted as a genuine change.
    expect(result.details.sleep_backfill).toMatchObject({ rows_changed: 1 });
    // The actual regression signal: under the wrong ordering this stays
    // 7.5 forever (persistAll's own recompute only touches 2025-04-12, the
    // date it just fetched — never 2025-04-11).
    expect(dailySummarySleepHours(1, "2025-04-11")).toBeNull();
    expect(sleepDateFor(1, "sleep-2025-04-12")).toBe("2025-04-12");
  });

  it("re-dates a pre-existing wrong-date row as part of the sync's first-run backfill", async () => {
    // A row already in the DB from before the fix shipped, filed under its
    // start day. The sync's own fetch (wireHappyPath) writes an unrelated
    // 2025-04-12 sleep; the backfill's job is this pre-existing row.
    seedSleepRow(
      1,
      "sleep-legacy",
      "2026-04-28",
      JSON.stringify({ id: "sleep-legacy", end: "2026-04-29T08:38:56.000Z" }),
    );
    wireHappyPath();

    const result = await syncMod.runWhoopSync({ userId: 1 });

    expect(result.success).toBe(true);
    expect(result.details.sleep_backfill_error).toBeUndefined();
    expect(result.details.sleep_backfill).toMatchObject({ rows_changed: 1 });
    expect(sleepDateFor(1, "sleep-legacy")).toBe("2026-04-29");
  });

  it("a row with unparseable raw is skipped, not fatal to the sync", async () => {
    seedSleepRow(1, "sleep-bad", "2026-04-28", "{not valid json");
    wireHappyPath();

    const result = await syncMod.runWhoopSync({ userId: 1 });

    expect(result.success).toBe(true);
    expect(result.details.sleep_backfill_error).toBeUndefined();
    expect(result.details.sleep_backfill?.rows_skipped).toBeGreaterThanOrEqual(1);
  });
});

describe("runWhoopSync + cycles reconcile wiring (issue #415)", () => {
  beforeEach(() => {
    vi.stubEnv("CYCLES_RECONCILE_LOOKBACK_DAYS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("wires reconcile results into details.reconcile", async () => {
    setBackfillMarker(1, true);
    wireHappyPath();

    const result = await syncMod.runWhoopSync({ userId: 1 });

    expect(result.success).toBe(true);
    expect(result.details.reconcile).toEqual({
      lookback_days: 30,
      orphans_found: 0,
      healed: 0,
      still_missing: 0,
      api_calls: 0,
    });
    // The happy-path fixture's recovery+cycle dates match, so reconcile finds
    // nothing to do — the main sync's own /v2/cycle fetch is the only one.
    const cycleCalls = whoopGetAllMock.mock.calls.filter(
      (c) => c[0] === "/v2/cycle",
    );
    expect(cycleCalls).toHaveLength(1);
  });

  it("does not re-fetch a date the sync's own window already covered", async () => {
    // runWhoopSync is fetch -> persistAll -> reconcile. A recovery-only date
    // inside the fetched window is, by construction, one upstream just
    // reported as unscored; re-querying the identical range for the identical
    // answer is a deterministic waste. Before this fix the sync issued two
    // /v2/cycle calls here, the second a strict subset of the first.
    setBackfillMarker(1, true);
    seedRecoveryOnly(1, daysAgoDateStr(3));
    wireHappyPath();

    const result = await syncMod.runWhoopSync({ userId: 1 });

    expect(result.success).toBe(true);
    expect(result.details.reconcile?.orphans_found).toBe(0);
    expect(result.details.reconcile?.still_missing).toBe(0);
    const cycleCalls = whoopGetAllMock.mock.calls.filter(
      (c) => c[0] === "/v2/cycle",
    );
    expect(cycleCalls).toHaveLength(1);
  });

  it("runs the one-time backfill on first sync and the routine pass thereafter", async () => {
    setBackfillMarker(1, false);
    wireHappyPath();

    const first = await syncMod.runWhoopSync({ userId: 1 });
    expect(first.details.cycles_backfill).toBeDefined();
    // Superset of the routine band, so the routine pass is skipped that once.
    expect(first.details.reconcile).toBeUndefined();

    const second = await syncMod.runWhoopSync({ userId: 1 });
    expect(second.details.cycles_backfill).toBeUndefined();
    expect(second.details.reconcile).toBeDefined();
  });

  it("a reconcile failure never fails an otherwise-successful sync", async () => {
    setBackfillMarker(1, true);
    seedRecoveryOnly(1, daysAgoDateStr(20));
    wireHappyPath();
    const happy = whoopGetAllMock.getMockImplementation()!;
    let cycleCalls = 0;
    whoopGetAllMock.mockImplementation(async (endpoint: string, ...rest: unknown[]) => {
      if (endpoint === "/v2/cycle" && ++cycleCalls > 1) {
        throw new Error("upstream 503");
      }
      return happy(endpoint, ...rest);
    });

    const result = await syncMod.runWhoopSync({ userId: 1 });

    expect(result.success).toBe(true);
    expect(result.partial).toBeUndefined();
    expect(result.details.reconcile).toBeUndefined();
    expect(result.details.reconcile_error).toBe("upstream 503");
  });
});

describe("runWhoopSync userId plumbing", () => {
  it("forwards userId to the pre-warm and to each whoopGetAll/whoopGet call", async () => {
    wireHappyPath();
    const userId = 7;
    // The domain tables FK-reference users(id) post-Phase D. Seed the user.
    const seed = new Database(dbFile);
    try {
      seed.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(userId);
    } finally {
      seed.close();
    }

    const result = await syncMod.runWhoopSync({ userId });
    expect(result.success).toBe(true);

    // Pre-warm received the userId as its first arg.
    expect(getValidAccessTokenMock).toHaveBeenCalled();
    const preWarmArgs = getValidAccessTokenMock.mock.calls[0];
    expect(preWarmArgs[0]).toBe(userId);

    // Every whoopGetAll call carries opts.userId. Body uses whoopGet.
    for (const call of whoopGetAllMock.mock.calls) {
      const opts = call[2] as { userId: number };
      expect(opts.userId).toBe(userId);
    }
    for (const call of whoopGetMock.mock.calls) {
      const opts = call[1] as { userId: number };
      expect(opts.userId).toBe(userId);
    }
  });
});
