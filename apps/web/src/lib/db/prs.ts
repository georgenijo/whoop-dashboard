import "server-only";
import { forUser } from "./scoped";
import { SLEEP_DEDUP_WHERE } from "./sleep";
import { dbPath } from "./connection";
import { getStepsRange } from "./steps";
import type { RecordSeries } from "@/lib/analytics/records";

export type PRValue = { value: number; date: string } | null;
export type PRStreak = {
  count: number;
  start_date: string;
  end_date: string;
} | null;

export type PRStats = {
  bestHRV: PRValue;
  lowestRHR: PRValue;
  recoveryStreak: PRStreak;
  sleepPerfStreak: PRStreak;
  loggingStreak: PRStreak;
};

const MS_PER_DAY = 86_400_000;
const statsCache = new Map<string, PRStats>();

function parseDate(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function longestStreak(dates: string[]): NonNullable<PRStreak> | null {
  if (dates.length === 0) return null;
  const sorted = Array.from(new Set(dates)).sort();
  let best = { count: 1, start_date: sorted[0], end_date: sorted[0] };
  let runStart = sorted[0];
  let runLen = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = parseDate(sorted[i - 1]);
    const curr = parseDate(sorted[i]);
    if (curr - prev === MS_PER_DAY) {
      runLen += 1;
    } else {
      runStart = sorted[i];
      runLen = 1;
    }
    if (runLen > best.count) {
      best = { count: runLen, start_date: runStart, end_date: sorted[i] };
    }
  }
  return best;
}

export function getBestHRV(userId: number): PRValue {
  const row = forUser(userId).get<{ date: string; value: number }>(
    "SELECT date, hrv AS value FROM recovery WHERE hrv IS NOT NULL AND hrv > 0 AND user_id = ? ORDER BY hrv DESC, date DESC LIMIT 1",
  );
  return row ?? null;
}

export function getLowestRHR(userId: number): PRValue {
  const row = forUser(userId).get<{ date: string; value: number }>(
    "SELECT date, rhr AS value FROM recovery WHERE rhr IS NOT NULL AND rhr > 0 AND user_id = ? ORDER BY rhr ASC, date DESC LIMIT 1",
  );
  return row ?? null;
}

export function getStreaks(userId: number): {
  recoveryStreak: PRStreak;
  sleepPerfStreak: PRStreak;
  loggingStreak: PRStreak;
} {
  const recoveryDates = forUser(userId)
    .all<{ date: string }>(
      "SELECT date FROM recovery WHERE recovery_score >= 80 AND user_id = ? ORDER BY date ASC",
    )
    .map((r) => r.date);

  // Same one-row-per-date dedup as the sleep.ts trend/range queries (issue
  // #440 review, WARN 6): without it, a two-sleep date counted toward the
  // streak whenever ANY row on it scored >=85, while every other surface
  // (charts, daily_summary) reports only the longer sleep's score — a date
  // could count here on a 10-minute fragment's 90% while the chart shows
  // the 8-hour sleep's 70%.
  const sleepPerfDates = forUser(userId)
    .all<{ date: string }>(
      `SELECT date FROM sleep s WHERE COALESCE(s.nap, 0) = 0 AND ${SLEEP_DEDUP_WHERE} AND s.performance >= 85 AND s.user_id = ? ORDER BY s.date ASC`,
    )
    .map((r) => r.date);

  // The legacy SQL did a `UNION` across recovery + sleep dates with a single
  // ORDER BY — the wrapper's trailing-bind convention doesn't compose with
  // UNION (each branch needs its own user_id placeholder), so we run two
  // separate scoped queries and merge distinct dates in JS.
  const recoveryDatesAll = forUser(userId)
    .all<{ date: string }>(
      "SELECT date FROM recovery WHERE user_id = ? ORDER BY date ASC",
    )
    .map((r) => r.date);
  const sleepDatesAll = forUser(userId)
    .all<{ date: string }>(
      "SELECT date FROM sleep WHERE COALESCE(nap, 0) = 0 AND user_id = ? ORDER BY date ASC",
    )
    .map((r) => r.date);
  const loggingDates = Array.from(
    new Set([...recoveryDatesAll, ...sleepDatesAll]),
  ).sort();

  return {
    recoveryStreak: longestStreak(recoveryDates),
    sleepPerfStreak: longestStreak(sleepPerfDates),
    loggingStreak: longestStreak(loggingDates),
  };
}

/**
 * The tenant's PR-stats change counter, bumped by triggers on every insert,
 * edit or delete in `recovery` / `sleep` (see `migrateSchema`). `null` when the
 * triggers are not known to exist (a DB `openWrite()` has not migrated yet, or
 * no app_settings table): callers must not cache then.
 */
function prStatsVersion(userId: number): number | null {
  return (
    forUser(userId).read((db, uid) => {
      try {
        const rows = db
          .prepare(
            "SELECT key, value FROM app_settings WHERE key IN (?, 'pr_stats_triggers')",
          )
          .all(`pr_stats_version:${uid}`) as { key: string; value: string | null }[];
        if (!rows.some((r) => r.key === "pr_stats_triggers")) return null;
        const own = rows.find((r) => r.key !== "pr_stats_triggers");
        return own ? Number(own.value) : 0;
      } catch {
        return null;
      }
    }) ?? null
  );
}

export function getPRStats(userId: number): PRStats {
  const version = prStatsVersion(userId);
  const cacheKey = `${dbPath()}\u0000${userId}:${version}`;
  const cached = version === null ? undefined : statsCache.get(cacheKey);
  if (cached) return cached;
  const streaks = getStreaks(userId);
  const stats = {
    bestHRV: getBestHRV(userId),
    lowestRHR: getLowestRHR(userId),
    recoveryStreak: streaks.recoveryStreak,
    sleepPerfStreak: streaks.sleepPerfStreak,
    loggingStreak: streaks.loggingStreak,
  };
  if (version !== null) {
    // Bound this process-local cache: only the current key per DB+user is useful.
    const prefix = `${dbPath()}\u0000${userId}:`;
    for (const key of statsCache.keys()) if (key.startsWith(prefix) && key !== cacheKey) statsCache.delete(key);
    statsCache.set(cacheKey, stats);
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Full-history record series for the /records page (RECORDS_PAGE=1).
//
// Only called by that page, so with the flag off none of these reads run.
// Filters match the PR queries above so the page and the Overview card agree:
// HRV/RHR ignore NULL and non-positive readings (getBestHRV/getLowestRHR),
// sleep uses the same non-nap, one-row-per-date dedup as getStreaks, and
// steps go through the existing steps reader (one resolved source, open
// in-progress Whoop cycles excluded — a partial count is not a day's total).
// ---------------------------------------------------------------------------

function positive(v: number | null): number | null {
  return v !== null && v > 0 ? v : null;
}

export function getRecordSeries(userId: number): RecordSeries {
  const scoped = forUser(userId);
  const recovery = scoped.all<{
    date: string;
    recovery_score: number | null;
    hrv: number | null;
    rhr: number | null;
  }>(
    "SELECT date, recovery_score, hrv, rhr FROM recovery WHERE user_id = ? ORDER BY date ASC",
  );
  const cycles = scoped.all<{ date: string; strain: number | null }>(
    "SELECT date, strain FROM cycles WHERE strain IS NOT NULL AND user_id = ? ORDER BY date ASC",
  );
  // Time asleep = light + deep + REM (awake time in bed excluded). NULL when
  // no stage data exists at all, so an unstaged row can't read as 0 h.
  const sleep = scoped.all<{ date: string; asleep_ms: number | null; performance: number | null }>(
    `SELECT s.date,
            CASE WHEN s.light_ms IS NULL AND s.deep_ms IS NULL AND s.rem_ms IS NULL THEN NULL
                 ELSE COALESCE(s.light_ms, 0) + COALESCE(s.deep_ms, 0) + COALESCE(s.rem_ms, 0) END AS asleep_ms,
            s.performance
     FROM sleep s WHERE COALESCE(s.nap, 0) = 0 AND ${SLEEP_DEDUP_WHERE} AND s.user_id = ? ORDER BY s.date ASC`,
  );
  const workouts = scoped.all<{ date: string; duration_sec: number; sport: string | null }>(
    "SELECT date, duration_sec, sport FROM workouts WHERE duration_sec IS NOT NULL AND duration_sec > 0 AND user_id = ? ORDER BY date ASC, id ASC",
  );
  const steps = getStepsRange(userId, "0000-01-01", "9999-12-31").filter((r) => !r.is_partial);

  return {
    hrv: recovery.map((r) => ({ date: r.date, value: positive(r.hrv) })),
    rhr: recovery.map((r) => ({ date: r.date, value: positive(r.rhr) })),
    recovery: recovery.map((r) => ({ date: r.date, value: r.recovery_score })),
    strain: cycles.map((r) => ({ date: r.date, value: r.strain })),
    sleepDuration: sleep.map((r) => ({ date: r.date, value: positive(r.asleep_ms) })),
    sleepPerformance: sleep.map((r) => ({ date: r.date, value: r.performance })),
    workoutDuration: workouts.map((r) => ({ date: r.date, value: r.duration_sec, note: r.sport })),
    steps: steps.map((r) => ({ date: r.date, value: positive(r.steps) })),
  };
}
