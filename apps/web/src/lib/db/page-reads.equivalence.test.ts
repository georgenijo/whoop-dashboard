// @vitest-environment node
//
// Issue #591: old/new output equivalence for every page read path that was
// consolidated. The "old" side is the pre-change behaviour, kept here as
// reference code built from the read functions that were NOT changed (the
// separate latest/previous/trend/range queries, the per-call steps source
// resolution, the full-history daily_summary scan, the uncached PR stats,
// getWorkoutsRange, and the three separate workout-detail reads), or computed
// by hand from the fixture. Everything runs against a temp SQLite file
// (WHOOP_DB_PATH); one user per scenario.
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "page-reads-equiv-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;
new Database(dbFile).close();

import { openWrite, TREND_MAX_POINTS, safeDays } from "./connection";
import {
  getDailySummary,
  getDailySummaryForDates,
  getOverview,
  getOverviewSnapshot,
  type Overview,
} from "./summary";
import {
  getLatestRecovery,
  getPreviousRecovery,
  getRecoveryRange,
  getRecoveryTrend,
  getRecoveryTrendSampled,
} from "./recovery";
import {
  getLatestCycle,
  getPreviousCycle,
  getStrainRange,
  getStrainTrend,
  getStrainTrendSampled,
} from "./strain";
import {
  getLatestSleep,
  getPreviousSleep,
  getSleepRange,
  getSleepTrend,
  getSleepTrendSampled,
} from "./sleep";
import {
  getLatestSteps,
  getPreviousSteps,
  getStepsPair,
} from "./steps";
import { getBestHRV, getLowestRHR, getPRStats, getStreaks, type PRStats } from "./prs";
import {
  capWorkoutRows,
  getWorkoutById,
  getWorkoutDetail,
  getWorkoutHrSeries,
  getWorkoutRowsRange,
  getWorkoutSource,
  getWorkoutsRange,
  type WorkoutRow,
} from "./workouts";
import { resolveRangeWindow, rowsInWindow, shiftDate } from "@/lib/range";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const U_NONE = 1; //     no data at all
const U_SINGLE = 2; //   exactly one day of everything, no steps
const U_SHORT = 3; //    120 days (< TREND_MAX_POINTS): all-range is exact
const U_LONG = 4; //     800 days, naps, same-date sleeps, native + apple steps, 520 workouts
const U_APPLE = 5; //    apple steps only
const U_FALLBACK = 6; // whoop_cycle_steps rows exist but every step_count is NULL, plus apple steps
const U_NATIVE = 7; //   native steps only (no apple rows)
const U_OTHER = 8; //    another tenant that must never leak into anyone's reads
const U_CACHE = 9; //    PR-stats cache invalidation

const LONG_DAYS = 800;
const SHORT_DAYS = 120;
const START = "2024-01-01";
const dayAt = (i: number) => shiftDate(START, i);
const LONG_END = dayAt(LONG_DAYS - 1);
const SHORT_END = dayAt(SHORT_DAYS - 1);

// Small deterministic generator so values vary without Math.random().
function val(seed: number, lo: number, hi: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return Math.round((lo + (x - Math.floor(x)) * (hi - lo)) * 10) / 10;
}

type Db = InstanceType<typeof Database>;

function seedDays(db: Db, uid: number, days: number, opts: { skipEvery?: number } = {}) {
  const rec = db.prepare(
    "INSERT INTO recovery (user_id, date, recovery_score, hrv, rhr, spo2, skin_temp) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const cyc = db.prepare(
    "INSERT INTO cycles (user_id, date, strain, kilojoule, avg_hr, max_hr) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const slp = db.prepare(
    "INSERT INTO sleep (user_id, sleep_id, date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms, performance, efficiency, nap) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const sum = db.prepare(
    "INSERT INTO daily_summary (user_id, date, recovery_score, hrv_ms, resting_hr, sleep_hours, day_strain) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    for (let i = 0; i < days; i++) {
      const d = dayAt(i);
      const s = uid * 10_000 + i;
      // recovery and cycles skip different days so the tables' tails differ.
      const skipR = opts.skipEvery && i % opts.skipEvery === 3 && i < days - 3;
      const skipC = opts.skipEvery && i % (opts.skipEvery + 2) === 5 && i < days - 3;
      if (!skipR) {
        rec.run(uid, d, val(s, 10, 99), val(s + 1, 30, 120), val(s + 2, 40, 70), val(s + 3, 94, 99), val(s + 4, 33, 36));
        // Some summary rows have a NULL recovery score (filtered by the page).
        sum.run(uid, d, i % 7 === 0 ? null : Math.round(val(s, 10, 99)), val(s + 1, 30, 120), Math.round(val(s + 2, 40, 70)), val(s + 5, 5, 9), val(s + 6, 0, 20));
      }
      if (!skipC) cyc.run(uid, d, val(s + 7, 0, 21), val(s + 8, 4000, 20000), Math.round(val(s + 9, 55, 90)), Math.round(val(s + 10, 120, 190)));
      slp.run(uid, `s-${uid}-${i}`, d, Math.round(val(s + 11, 6, 9) * 3_600_000), 3_000_000, 4_000_000, 5_000_000, 600_000, 30_000_000, val(s + 12, 40, 100), val(s + 13, 70, 99), 0);
    }
  })();
}

function seedLongExtras(db: Db, uid: number) {
  const slp = db.prepare(
    "INSERT INTO sleep (user_id, sleep_id, date, in_bed_ms, light_ms, deep_ms, rem_ms, performance, efficiency, nap) VALUES (?, ?, ?, ?, 1, 1, 1, ?, ?, ?)",
  );
  db.transaction(() => {
    for (let i = 0; i < LONG_DAYS; i++) {
      // A nap on every 5th day, including the very last day.
      if (i % 5 === 0 || i === LONG_DAYS - 1) slp.run(uid, `nap-${uid}-${i}`, dayAt(i), 1_200_000, 50, 60, 1);
      // A second, shorter non-nap sleep ending on the same date (dedup rule).
      if (i % 23 === 0 || i === LONG_DAYS - 1) slp.run(uid, `alt-${uid}-${i}`, dayAt(i), 600_000, 99, 99, 0);
    }
  })();
}

function seedWorkouts(db: Db, uid: number, count: number, endIndex: number) {
  const ins = db.prepare(
    "INSERT INTO workouts (user_id, id, date, sport, duration_sec, avg_hr, max_hr, strain, kilojoule, distance_m, zone_0_ms, zone_1_ms, zone_2_ms, zone_3_ms, zone_4_ms, zone_5_ms, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 2, 3, 4, 5, 6, ?)",
  );
  db.transaction(() => {
    for (let k = 0; k < count; k++) {
      // Two workouts share a date for every other k: same-date rows exist.
      const i = endIndex - Math.floor(k / 2);
      const d = dayAt(i);
      ins.run(
        uid, `w-${uid}-${k}`, d, k % 3 ? "Running" : "Cycling", 1800 + k, 120, 170, val(k, 4, 18), 900, k % 4 ? 5000 : null,
        JSON.stringify({ start: `${d}T07:00:00Z`, end: `${d}T08:00:00Z` }),
      );
    }
  })();
}

function seedSteps(db: Db, uid: number, o: { apple?: number; native?: number; nativeNull?: number }) {
  const apple = db.prepare(
    "INSERT INTO daily_steps (user_id, date, steps, source) VALUES (?, ?, ?, 'apple_health')",
  );
  const native = db.prepare(
    "INSERT INTO whoop_cycle_steps (user_id, cycle_id, date, cycle_start, cycle_end, score_state, step_count, upstream_updated_at) VALUES (?, ?, ?, ?, ?, 'SCORED', ?, ?)",
  );
  db.transaction(() => {
    for (let i = 0; i < (o.apple ?? 0); i++) apple.run(uid, dayAt(i), 3000 + i);
    for (let i = 0; i < (o.native ?? 0); i++) {
      // The newest cycle is still open (no cycle_end) => is_partial.
      const open = i === (o.native ?? 0) - 1;
      native.run(uid, uid * 1000 + i, dayAt(i), `${dayAt(i)}T04:00:00Z`, open ? null : `${dayAt(i)}T22:00:00Z`, 5000 + i, `${dayAt(i)}T23:00:00Z`);
    }
    for (let i = 0; i < (o.nativeNull ?? 0); i++) {
      native.run(uid, uid * 1000 + i, dayAt(i), `${dayAt(i)}T04:00:00Z`, `${dayAt(i)}T22:00:00Z`, null, `${dayAt(i)}T23:00:00Z`);
    }
  })();
}

beforeAll(() => {
  const w = openWrite();
  expect(w).not.toBeNull();
  w!.close();
  const db = new Database(dbFile);
  for (let u = 1; u <= 9; u++) db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(u);

  seedDays(db, U_SINGLE, 1);
  seedDays(db, U_SHORT, SHORT_DAYS, { skipEvery: 11 });
  seedSteps(db, U_SHORT, { apple: SHORT_DAYS });

  seedDays(db, U_LONG, LONG_DAYS, { skipEvery: 13 });
  seedLongExtras(db, U_LONG);
  seedSteps(db, U_LONG, { apple: LONG_DAYS, native: LONG_DAYS });
  seedWorkouts(db, U_LONG, 520, LONG_DAYS - 1);

  seedDays(db, U_APPLE, 40);
  seedSteps(db, U_APPLE, { apple: 40 });
  seedDays(db, U_FALLBACK, 40);
  seedSteps(db, U_FALLBACK, { apple: 40, nativeNull: 40 });
  seedDays(db, U_NATIVE, 40);
  seedSteps(db, U_NATIVE, { native: 40 });

  seedDays(db, U_OTHER, 60);
  seedSteps(db, U_OTHER, { apple: 60, native: 60 });
  seedWorkouts(db, U_OTHER, 30, 59);
  db.close();
});

afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Reference ("old") implementations
// ---------------------------------------------------------------------------

/** Pre-change getOverview: separate latest/previous queries + trend fetches. */
function refOverview(uid: number, days = 30, source: "whoop" | "apple_health" | "auto" = "auto"): Overview {
  const latestRecovery = getLatestRecovery(uid);
  const latestCycle = getLatestCycle(uid);
  const latestSleep = getLatestSleep(uid);
  return {
    latestRecovery,
    previousRecovery: getPreviousRecovery(uid),
    latestCycle,
    previousCycle: getPreviousCycle(uid),
    latestSleep,
    previousSleep: getPreviousSleep(uid),
    recoveryTrend: getRecoveryTrend(uid, days),
    strainTrend: getStrainTrend(uid, days),
    sleepTrend: getSleepTrend(uid, days),
    latestSteps: getLatestSteps(uid, source),
    previousSteps: getPreviousSteps(uid, source),
    hasData: Boolean(latestRecovery || latestCycle || latestSleep),
  };
}

/** Pre-change getPRStats: no cache, recomputed on every call. */
function refPRStats(uid: number): PRStats {
  const streaks = getStreaks(uid);
  return {
    bestHRV: getBestHRV(uid),
    lowestRHR: getLowestRHR(uid),
    recoveryStreak: streaks.recoveryStreak,
    sleepPerfStreak: streaks.sleepPerfStreak,
    loggingStreak: streaks.loggingStreak,
  };
}

/** What the sampled trend must be, computed by hand from the full trend. */
function handSampled<T>(newestLimited: T[], maxPoints: number): T[] {
  const n = newestLimited.length;
  const stride = Math.ceil(n / maxPoints);
  return newestLimited.filter((_, i) => {
    const rn = n - i; // 1 = newest
    return rn <= 2 || (rn - 1) % stride === 0;
  });
}

const ALL_USERS = [U_NONE, U_SINGLE, U_SHORT, U_LONG, U_APPLE, U_FALLBACK, U_NATIVE, U_OTHER];
const withoutTrends = ({ recoveryTrend, strainTrend, sleepTrend, ...rest }: Overview) => {
  void recoveryTrend; void strainTrend; void sleepTrend;
  return rest;
};

// ---------------------------------------------------------------------------
// Fixture sanity: the scenarios the issue asks for really exist
// ---------------------------------------------------------------------------

describe("fixture covers the required scenarios", () => {
  it("no data / single day / range=all / naps / native vs fallback steps", () => {
    expect(getRecoveryTrend(U_NONE, 9999)).toEqual([]);
    expect(getRecoveryTrend(U_SINGLE, 9999)).toHaveLength(1);
    expect(getRecoveryTrend(U_LONG, 9999).length).toBeGreaterThan(TREND_MAX_POINTS);
    expect(getRecoveryTrend(U_LONG, 9999).length).toBeLessThan(LONG_DAYS); // gaps: tails of the tables differ
    const naps = getSleepRange(U_LONG, START, LONG_END).length;
    expect(naps).toBe(LONG_DAYS); // naps and alt sleeps never add rows to the deduped range
    expect(getStepsPair(U_LONG)[0]?.source).toBe("whoop");
    expect(getStepsPair(U_APPLE)[0]?.source).toBe("apple_health");
    expect(getStepsPair(U_FALLBACK)[0]?.source).toBe("apple_health");
    expect(getStepsPair(U_SINGLE)).toEqual([null, null]);
  });
});

// ---------------------------------------------------------------------------
// getOverview / getOverviewSnapshot
// ---------------------------------------------------------------------------

describe("getOverview equals the pre-change composition", () => {
  const DAYS = [1, 2, 7, 14, 30, 90, 0, -5, Number.NaN];

  for (const uid of ALL_USERS) {
    it(`user ${uid}: every picker window and degenerate day counts, source auto`, () => {
      for (const days of DAYS) {
        expect(getOverview(uid, days), `days=${days}`).toEqual(refOverview(uid, days));
      }
    });
  }

  it("honours an explicit steps source exactly like the separate calls", () => {
    for (const uid of [U_LONG, U_APPLE, U_FALLBACK, U_NATIVE, U_SINGLE]) {
      for (const source of ["whoop", "apple_health"] as const) {
        expect(getOverview(uid, 30, source)).toEqual(refOverview(uid, 30, source));
      }
    }
  });

  it("range=all is exact while the history fits under the downsample cap", () => {
    for (const uid of [U_NONE, U_SINGLE, U_SHORT, U_APPLE, U_FALLBACK, U_NATIVE, U_OTHER]) {
      expect(getOverview(uid, 9999), `user ${uid}`).toEqual(refOverview(uid, 9999));
    }
  });

  it("range=all downsampled: KPI fields, steps and hasData are exactly the old values", () => {
    const got = getOverview(U_LONG, 9999);
    const old = refOverview(U_LONG, 9999);
    expect(withoutTrends(got)).toEqual(withoutTrends(old));
  });

  it("range=all downsampled: trends equal the hand-computed stride sample of the old trends", () => {
    const got = getOverview(U_LONG, 9999);
    const old = refOverview(U_LONG, 9999);
    expect(old.recoveryTrend.length).toBeGreaterThan(TREND_MAX_POINTS);
    expect(got.recoveryTrend).toEqual(handSampled(old.recoveryTrend, TREND_MAX_POINTS));
    expect(got.strainTrend).toEqual(handSampled(old.strainTrend, TREND_MAX_POINTS));
    expect(got.sleepTrend).toEqual(handSampled(old.sleepTrend, TREND_MAX_POINTS));
    for (const t of [got.recoveryTrend, got.strainTrend, got.sleepTrend]) {
      expect(t.length).toBeLessThanOrEqual(TREND_MAX_POINTS + 1); // stride keeps the 2 newest on top of the stride grid
      const dates = t.map((r) => r.date);
      expect([...dates].sort()).toEqual(dates); // oldest first
      expect(new Set(dates).size).toBe(dates.length);
    }
    // The newest two readings survive sampling, so latest/previous derive correctly.
    expect(got.recoveryTrend.at(-1)).toEqual(old.latestRecovery);
    expect(got.recoveryTrend.at(-2)).toEqual(old.previousRecovery);
    expect(got.sleepTrend.at(-1)).toEqual(old.latestSleep);
    expect(got.sleepTrend.at(-2)).toEqual(old.previousSleep);
    expect(got.strainTrend.at(-1)).toEqual(old.latestCycle);
    expect(got.strainTrend.at(-2)).toEqual(old.previousCycle);
  });

  it("sampled trend helpers: a small cap exercises the stride and never leaks another tenant", () => {
    const cap = 50;
    const oldR = getRecoveryTrend(U_LONG, 3650);
    expect(getRecoveryTrendSampled(U_LONG, 3650, cap)).toEqual(handSampled(oldR, cap));
    expect(getStrainTrendSampled(U_LONG, 3650, cap)).toEqual(handSampled(getStrainTrend(U_LONG, 3650), cap));
    expect(getSleepTrendSampled(U_LONG, 3650, cap)).toEqual(handSampled(getSleepTrend(U_LONG, 3650), cap));
    // `days` below the history length limits the pool before sampling (newest `days` rows).
    expect(getRecoveryTrendSampled(U_LONG, 200, cap)).toEqual(handSampled(getRecoveryTrend(U_LONG, 200), cap));
    // Under the cap the stride is 1: identical to the unsampled query.
    expect(getRecoveryTrendSampled(U_SHORT, 3650, 365)).toEqual(getRecoveryTrend(U_SHORT, 3650));
    expect(getSleepTrendSampled(U_SINGLE, 3650, 365)).toEqual(getSleepTrend(U_SINGLE, 3650));
    expect(getStrainTrendSampled(U_NONE, 3650, 365)).toEqual([]);
    expect(getRecoveryTrendSampled(U_SINGLE, 3650, cap)).toEqual(getRecoveryTrend(U_SINGLE, 3650));
    expect(safeDays(9999)).toBe(3650);
  });

  for (const uid of ALL_USERS) {
    it(`user ${uid}: getOverviewSnapshot is the old overview minus its trends`, () => {
      expect(getOverviewSnapshot(uid)).toEqual(withoutTrends(refOverview(uid, 30)));
      expect(getOverviewSnapshot(uid, "apple_health")).toEqual(withoutTrends(refOverview(uid, 30, "apple_health")));
    });
  }
});

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

describe("getStepsPair equals getLatestSteps + getPreviousSteps", () => {
  for (const uid of ALL_USERS) {
    for (const source of ["auto", "whoop", "apple_health"] as const) {
      it(`user ${uid} source ${source}`, () => {
        expect(getStepsPair(uid, source)).toEqual([getLatestSteps(uid, source), getPreviousSteps(uid, source)]);
      });
    }
  }

  it("native steps mark the open cycle partial; fallback source never mixes", () => {
    const [latest, previous] = getStepsPair(U_LONG);
    expect(latest).toMatchObject({ source: "whoop", is_partial: true });
    expect(previous).toMatchObject({ source: "whoop", is_partial: false });
    const [fLatest] = getStepsPair(U_FALLBACK);
    expect(fLatest).toMatchObject({ source: "apple_health" });
    expect(fLatest).not.toHaveProperty("is_partial");
  });
});

// ---------------------------------------------------------------------------
// Overview page: daily_summary lookup for two dates
// ---------------------------------------------------------------------------

describe("getDailySummaryForDates equals the full-history scan filtered to those dates", () => {
  const old = (uid: number, dates: string[]) =>
    getDailySummary(uid, "0000-01-01", "9999-12-31").filter((r) => dates.includes(r.date));

  it("the two dates the overview page asks for", () => {
    for (const uid of [U_SINGLE, U_SHORT, U_LONG, U_APPLE]) {
      const snap = getOverviewSnapshot(uid);
      const dates = [snap.latestRecovery?.date, snap.previousRecovery?.date].filter((d): d is string => !!d);
      expect(getDailySummaryForDates(uid, dates), `user ${uid}`).toEqual(old(uid, dates));
    }
  });

  it("no data, duplicate dates, absent dates and no dates", () => {
    expect(getDailySummaryForDates(U_NONE, [START])).toEqual(old(U_NONE, [START]));
    expect(getDailySummaryForDates(U_SHORT, [START, START, "1999-01-01"])).toEqual(old(U_SHORT, [START, "1999-01-01"]));
    expect(getDailySummaryForDates(U_SHORT, [])).toEqual([]);
  });

  it("never returns another tenant's rows", () => {
    expect(getDailySummaryForDates(U_SHORT, [START]).length).toBe(1);
    expect(getDailySummaryForDates(U_SHORT, [START])[0]).toEqual(old(U_SHORT, [START])[0]);
  });
});

// ---------------------------------------------------------------------------
// PR stats cache
// ---------------------------------------------------------------------------

describe("getPRStats equals the uncached computation", () => {
  for (const uid of ALL_USERS) {
    it(`user ${uid}`, () => {
      expect(getPRStats(uid)).toEqual(refPRStats(uid));
      // Served from the cache the second time, still equal.
      expect(getPRStats(uid)).toEqual(refPRStats(uid));
    });
  }

  it("a newer day invalidates the cache and the stats follow the data", () => {
    const db = new Database(dbFile);
    db.prepare("INSERT INTO recovery (user_id, date, recovery_score, hrv, rhr) VALUES (?, ?, 90, 50, 50)").run(U_CACHE, "2025-03-01");
    db.close();
    const before = getPRStats(U_CACHE);
    expect(before).toEqual(refPRStats(U_CACHE));
    expect(before.bestHRV).toEqual({ value: 50, date: "2025-03-01" });
    expect(getPRStats(U_CACHE)).toBe(before); // unchanged data: the cached object

    const w = new Database(dbFile);
    w.prepare("INSERT INTO recovery (user_id, date, recovery_score, hrv, rhr) VALUES (?, ?, 95, 90, 40)").run(U_CACHE, "2025-03-02");
    w.close();
    const after = getPRStats(U_CACHE);
    expect(after).toEqual(refPRStats(U_CACHE));
    expect(after.bestHRV).toEqual({ value: 90, date: "2025-03-02" });
    expect(after.recoveryStreak?.count).toBe(2);
  });

  describe("historical changes invalidate the cache (older edit, older backfill, delete, tenants)", () => {
    const A = 10;
    const B = 11;
    const run = (fn: (db: Db) => void) => {
      const db = new Database(dbFile);
      try { fn(db); } finally { db.close(); }
    };
    const rec = (db: Db, uid: number, date: string, hrv: number, rhr = 55, score = 90) =>
      db.prepare("INSERT INTO recovery (user_id, date, recovery_score, hrv, rhr) VALUES (?, ?, ?, ?, ?)").run(uid, date, score, hrv, rhr);

    beforeAll(() => {
      run((db) => {
        for (const u of [A, B]) db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(u);
        for (const u of [A, B]) {
          rec(db, u, "2025-03-01", 60);
          rec(db, u, "2025-03-02", 40);
          rec(db, u, "2025-03-03", 45); // newest row: its date/raw never changes below
        }
        db.prepare("INSERT INTO sleep (user_id, sleep_id, date, in_bed_ms, performance, nap) VALUES (?, ?, ?, 1, ?, 0)").run(A, "a-old", "2025-03-01", 50);
      });
    });

    it("older-row edit: best HRV follows an edit of a day that is not the newest", () => {
      expect(getPRStats(A).bestHRV).toEqual({ value: 60, date: "2025-03-01" });
      expect(getPRStats(A)).toBe(getPRStats(A)); // cached while nothing changes
      run((db) => db.prepare("UPDATE recovery SET hrv = 150 WHERE user_id = ? AND date = '2025-03-01'").run(A));
      expect(getPRStats(A).bestHRV).toEqual({ value: 150, date: "2025-03-01" });
      expect(getPRStats(A)).toEqual(refPRStats(A));
    });

    it("older backfill: a row inserted before every existing date is picked up", () => {
      run((db) => rec(db, A, "2025-02-01", 200, 30));
      const s = getPRStats(A);
      expect(s.bestHRV).toEqual({ value: 200, date: "2025-02-01" });
      expect(s.lowestRHR).toEqual({ value: 30, date: "2025-02-01" });
      expect(s).toEqual(refPRStats(A));
    });

    it("older sleep edit: the sleep-performance streak follows a non-newest sleep row", () => {
      expect(getPRStats(A).sleepPerfStreak).toBeNull();
      run((db) => db.prepare("UPDATE sleep SET performance = 95 WHERE user_id = ? AND sleep_id = 'a-old'").run(A));
      expect(getPRStats(A).sleepPerfStreak).toMatchObject({ count: 1, start_date: "2025-03-01" });
      expect(getPRStats(A)).toEqual(refPRStats(A));
    });

    it("deletion: removing the best (older) day falls back to the next best", () => {
      run((db) => db.prepare("DELETE FROM recovery WHERE user_id = ? AND date = '2025-02-01'").run(A));
      expect(getPRStats(A).bestHRV).toEqual({ value: 150, date: "2025-03-01" });
      run((db) => db.prepare("DELETE FROM recovery WHERE user_id = ? AND date = '2025-03-01'").run(A));
      expect(getPRStats(A).bestHRV).toEqual({ value: 45, date: "2025-03-03" });
      run((db) => db.prepare("DELETE FROM sleep WHERE user_id = ?").run(A));
      expect(getPRStats(A).sleepPerfStreak).toBeNull();
      expect(getPRStats(A)).toEqual(refPRStats(A));
    });

    it("INSERT OR REPLACE (how sync upserts) over an older day also invalidates", () => {
      run((db) => db.prepare("INSERT OR REPLACE INTO recovery (user_id, date, recovery_score, hrv, rhr) VALUES (?, '2025-03-02', 90, 99, 55)").run(A));
      expect(getPRStats(A).bestHRV).toEqual({ value: 99, date: "2025-03-02" });
      expect(getPRStats(A)).toEqual(refPRStats(A));
    });

    it("tenant isolation: A's changes neither invalidate nor leak into B, and vice versa", () => {
      const b1 = getPRStats(B);
      expect(b1.bestHRV).toEqual({ value: 60, date: "2025-03-01" });
      run((db) => db.prepare("UPDATE recovery SET hrv = 300 WHERE user_id = ? AND date = '2025-03-03'").run(A));
      expect(getPRStats(A).bestHRV).toEqual({ value: 300, date: "2025-03-03" });
      expect(getPRStats(B)).toBe(b1); // B untouched: still the cached object
      expect(getPRStats(B).bestHRV).toEqual({ value: 60, date: "2025-03-01" });
      run((db) => db.prepare("UPDATE recovery SET hrv = 500 WHERE user_id = ? AND date = '2025-03-02'").run(B));
      expect(getPRStats(B).bestHRV).toEqual({ value: 500, date: "2025-03-02" });
      expect(getPRStats(A).bestHRV).toEqual({ value: 300, date: "2025-03-03" });
      expect(getPRStats(A)).toEqual(refPRStats(A));
      expect(getPRStats(B)).toEqual(refPRStats(B));
    });

    it("does not cache at all when the change-tracking triggers are not known to exist", () => {
      run((db) => db.prepare("DELETE FROM app_settings WHERE key = 'pr_stats_triggers'").run());
      try {
        const first = getPRStats(B);
        expect(getPRStats(B)).not.toBe(first); // recomputed, never served stale
        expect(getPRStats(B)).toEqual(refPRStats(B));
      } finally {
        run((db) => db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('pr_stats_triggers', '1')").run());
      }
    });

    it("re-assigning a row to another tenant invalidates both", () => {
      run((db) => rec(db, A, "2025-04-01", 700));
      const a = getPRStats(A);
      const b = getPRStats(B);
      expect(a.bestHRV).toEqual({ value: 700, date: "2025-04-01" });
      run((db) => db.prepare("UPDATE recovery SET user_id = ? WHERE user_id = ? AND date = '2025-04-01'").run(B, A));
      expect(getPRStats(A)).not.toEqual(a);
      expect(getPRStats(A)).toEqual(refPRStats(A));
      expect(getPRStats(A).bestHRV).toEqual({ value: 300, date: "2025-03-03" });
      expect(getPRStats(B)).not.toEqual(b);
      expect(getPRStats(B).bestHRV).toEqual({ value: 700, date: "2025-04-01" });
      expect(getPRStats(B)).toEqual(refPRStats(B));
    });
  });

  it("is keyed per tenant", () => {
    expect(getPRStats(U_SHORT)).toEqual(refPRStats(U_SHORT));
    expect(getPRStats(U_OTHER)).toEqual(refPRStats(U_OTHER));
    expect(getPRStats(U_SHORT)).not.toEqual(getPRStats(U_OTHER));
  });
});

// ---------------------------------------------------------------------------
// /recovery, /sleep, /strain: one wide range serves the window as well
// ---------------------------------------------------------------------------

describe("window rows derived from the wider baseline fetch equal the direct range query", () => {
  const RANGES = ["7d", "14d", "30d", "90d", "all", undefined];

  for (const uid of [U_NONE, U_SINGLE, U_SHORT, U_LONG]) {
    for (const range of RANGES) {
      it(`user ${uid} range ${range ?? "default"}`, () => {
        const today = uid === U_LONG ? LONG_END : SHORT_END;
        const w = resolveRangeWindow(range, today);
        const baseline14 = w.start === "0000-01-01" ? w.start : shiftDate(w.start, -14);
        const baseline180 = w.start === "0000-01-01" ? w.start : shiftDate(w.start, -180);
        // /recovery (recovery + sleep) and /strain (strain) — what each page did before.
        expect(rowsInWindow(getRecoveryRange(uid, baseline14, w.end), w.start, w.end)).toEqual(getRecoveryRange(uid, w.start, w.end));
        expect(rowsInWindow(getSleepRange(uid, baseline14, w.end), w.start, w.end)).toEqual(getSleepRange(uid, w.start, w.end));
        expect(rowsInWindow(getStrainRange(uid, baseline180, w.end), w.start, w.end)).toEqual(getStrainRange(uid, w.start, w.end));
      });
    }
  }

  it("windows that end before the newest data still match", () => {
    const end = dayAt(500);
    const start = dayAt(470);
    expect(rowsInWindow(getRecoveryRange(U_LONG, dayAt(456), end), start, end)).toEqual(getRecoveryRange(U_LONG, start, end));
  });

  it("/sleep: latest sleep is the snapshot's, even with naps and same-date sleeps", () => {
    for (const uid of ALL_USERS) {
      expect(getOverviewSnapshot(uid).latestSleep, `user ${uid}`).toEqual(getLatestSleep(uid));
    }
    // The newest date has a nap and a shorter second sleep: the longer non-nap wins.
    const latest = getOverviewSnapshot(U_LONG).latestSleep;
    expect(latest?.date).toBe(LONG_END);
    expect(latest?.in_bed_ms).not.toBe(1_200_000);
    expect(latest?.in_bed_ms).not.toBe(600_000);
  });
});

// ---------------------------------------------------------------------------
// /workouts and /workouts/[id]
// ---------------------------------------------------------------------------

// Rows on one date can come back in either order from a LIMITed vs unLIMITed
// ORDER BY date DESC (the sort is not stable across plans and the old page
// already mixed both orderings), so compare date order exactly and ids as a
// set per date.
function sameRowsModuloSameDateOrder(a: WorkoutRow[], b: WorkoutRow[]) {
  expect(a.map((r) => r.date)).toEqual(b.map((r) => r.date));
  const byDate = (rows: WorkoutRow[]) => {
    const m = new Map<string, WorkoutRow[]>();
    for (const r of rows) m.set(r.date, [...(m.get(r.date) ?? []), r]);
    for (const list of m.values()) list.sort((x, y) => x.id.localeCompare(y.id));
    return m;
  };
  expect(byDate(a)).toEqual(byDate(b));
}

describe("workouts list: one uncapped query + capWorkoutRows equals getWorkoutsRange", () => {
  const ranges: Array<[string, string, string]> = [
    ["no data", "0000-01-01", "9999-12-31"],
    ["7d", dayAt(LONG_DAYS - 7), LONG_END],
    ["30d", dayAt(LONG_DAYS - 30), LONG_END],
    ["90d", dayAt(LONG_DAYS - 90), LONG_END],
    ["all (520 rows, truncated)", "0000-01-01", "9999-12-31"],
    ["empty window", "1990-01-01", "1990-01-31"],
  ];

  for (const [label, start, end] of ranges) {
    it(`${label}`, () => {
      const uid = label === "no data" ? U_NONE : U_LONG;
      const old = getWorkoutsRange(uid, start, end);
      const uncapped = getWorkoutRowsRange(uid, start, end);
      const next = capWorkoutRows(uncapped);
      expect(next.truncated).toBe(old.truncated);
      expect(next.total_count).toBe(old.total_count);
      sameRowsModuloSameDateOrder(next.rows, old.rows);
      expect(next.rows).toHaveLength(old.rows.length);
    });
  }

  it("the all-range really is over the cap and total_count stays exact", () => {
    const next = capWorkoutRows(getWorkoutRowsRange(U_LONG, "0000-01-01", "9999-12-31"));
    expect(next).toMatchObject({ truncated: true, total_count: 520 });
    expect(next.rows).toHaveLength(500);
  });

  it("single workout and tenant isolation", () => {
    const one = getWorkoutRowsRange(U_OTHER, "0000-01-01", "9999-12-31").slice(0, 1);
    expect(capWorkoutRows(one)).toEqual({ rows: one, truncated: false, total_count: 1 });
    expect(getWorkoutRowsRange(U_LONG, "0000-01-01", "9999-12-31").every((r) => r.id.startsWith(`w-${U_LONG}-`))).toBe(true);
  });
});

describe("getWorkoutDetail equals getWorkoutById + getWorkoutHrSeries + getWorkoutSource", () => {
  const series = { interval_sec: 5, start_offset_sec: 0, bpm: [100, null, 130] };

  beforeAll(() => {
    const db = new Database(dbFile);
    const cols = (db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("hr_series");
    expect(cols).toContain("source");
    const set = db.prepare("UPDATE workouts SET hr_series = ?, source = ? WHERE id = ? AND user_id = ?");
    set.run(JSON.stringify(series), "healthkit", `w-${U_LONG}-0`, U_LONG);
    set.run(JSON.stringify(series), "whoop", `w-${U_LONG}-1`, U_LONG);
    set.run("{not json", "whoop", `w-${U_LONG}-2`, U_LONG);
    set.run(JSON.stringify({ interval_sec: 5 }), null, `w-${U_LONG}-3`, U_LONG); // no bpm array
    db.close();
  });

  const old = (uid: number, id: string) => {
    const workout = getWorkoutById(uid, id);
    return workout
      ? { workout, hrSeries: getWorkoutHrSeries(uid, id), source: getWorkoutSource(uid, id) }
      : undefined;
  };

  for (const k of [0, 1, 2, 3, 4, 519]) {
    it(`workout w-${U_LONG}-${k}`, () => {
      const id = `w-${U_LONG}-${k}`;
      expect(getWorkoutDetail(U_LONG, id)).toEqual(old(U_LONG, id));
    });
  }

  it("covers a HealthKit row with a series, a bad series and a missing series", () => {
    expect(getWorkoutDetail(U_LONG, `w-${U_LONG}-0`)).toMatchObject({ source: "healthkit", hrSeries: series });
    expect(getWorkoutDetail(U_LONG, `w-${U_LONG}-2`)).toMatchObject({ source: "whoop", hrSeries: null });
    expect(getWorkoutDetail(U_LONG, `w-${U_LONG}-3`)).toMatchObject({ hrSeries: null });
    expect(getWorkoutDetail(U_LONG, `w-${U_LONG}-4`)?.hrSeries).toBeNull();
    // The row itself never carries the extra columns the old getWorkoutById did not select.
    expect(Object.keys(getWorkoutDetail(U_LONG, `w-${U_LONG}-0`)!.workout)).toEqual(Object.keys(getWorkoutById(U_LONG, `w-${U_LONG}-0`)!));
  });

  it("unknown id and another tenant's id are both undefined", () => {
    expect(getWorkoutDetail(U_LONG, "nope")).toBeUndefined();
    expect(old(U_LONG, "nope")).toBeUndefined();
    expect(getWorkoutDetail(U_LONG, `w-${U_OTHER}-0`)).toBeUndefined();
    expect(getWorkoutDetail(U_NONE, `w-${U_LONG}-0`)).toBeUndefined();
  });
});
