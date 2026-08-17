import "server-only";
import { forUser } from "./scoped";
import { SLEEP_DEDUP_WHERE } from "./sleep";

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

export function getPRStats(userId: number): PRStats {
  const streaks = getStreaks(userId);
  return {
    bestHRV: getBestHRV(userId),
    lowestRHR: getLowestRHR(userId),
    recoveryStreak: streaks.recoveryStreak,
    sleepPerfStreak: streaks.sleepPerfStreak,
    loggingStreak: streaks.loggingStreak,
  };
}
