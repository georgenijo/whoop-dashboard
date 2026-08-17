import "server-only";
import { dateRangeClause, safeDays } from "./connection";
import { forUser } from "./scoped";

export type SleepRow = {
  date: string;
  in_bed_ms: number | null;
  light_ms: number | null;
  deep_ms: number | null;
  rem_ms: number | null;
  awake_ms: number | null;
  sleep_need_ms: number | null;
  performance: number | null;
  efficiency: number | null;
  consistency: number | null;
  disturbances: number | null;
  cycles: number | null;
  respiratory_rate: number | null;
  need_from_baseline_ms: number | null;
  need_from_debt_ms: number | null;
  need_from_strain_ms: number | null;
  need_from_nap_ms: number | null;
  start_local: string | null;
  end_local: string | null;
};

export type NapRow = {
  date: string;
  duration_ms: number | null;
  performance: number | null;
  efficiency: number | null;
  light_ms: number | null;
  deep_ms: number | null;
  rem_ms: number | null;
  awake_ms: number | null;
  start_local: string | null;
  end_local: string | null;
};

const SLEEP_COLUMNS =
  "date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms, performance, efficiency, consistency, disturbances, cycles, respiratory_rate, need_from_baseline_ms, need_from_debt_ms, need_from_strain_ms, need_from_nap_ms, start_local, end_local";

const NAP_COLUMNS =
  "date, in_bed_ms AS duration_ms, performance, efficiency, light_ms, deep_ms, rem_ms, awake_ms, start_local, end_local";

// Deterministic one-row-per-date pick (issue #440): wake-day attribution
// (sleepSummaryDate keying on `r.end` instead of `r.start`) removes same-day
// collisions caused by the old start-day filing, but two sleeps CAN still
// legitimately end on the same local date (wake 03:00, sleep again, wake
// 09:00). Without this, these queries could return two rows for one date —
// a chart series with a duplicate x value, or an arbitrary pick for
// getLatestSleep/getPreviousSleep. Longest in_bed_ms wins; sleep_id breaks
// ties, so the choice never depends on SQLite's unspecified row order.
// KEEP THIS RULE IN SYNC WITH the sleep-dedup subselects in sync.ts's
// SUMMARY_SELECT_SQL and upsert.ts's SELECT_DAILY_SUMMARY (three call sites,
// same tie-break).
const SLEEP_DEDUP_WHERE = `
  s.sleep_id = (
    SELECT s2.sleep_id FROM sleep s2
    WHERE s2.user_id = s.user_id AND s2.date = s.date AND COALESCE(s2.nap, 0) = 0
    ORDER BY s2.in_bed_ms DESC, s2.sleep_id DESC
    LIMIT 1
  )
`;

export function getLatestSleep(userId: number): SleepRow | null {
  const row = forUser(userId).get<SleepRow>(
    `SELECT ${SLEEP_COLUMNS} FROM sleep s WHERE COALESCE(s.nap, 0) = 0 AND ${SLEEP_DEDUP_WHERE} AND s.user_id = ? ORDER BY s.date DESC LIMIT 1`,
  );
  return row ?? null;
}

export function getPreviousSleep(userId: number): SleepRow | null {
  const row = forUser(userId).get<SleepRow>(
    `SELECT ${SLEEP_COLUMNS} FROM sleep s WHERE COALESCE(s.nap, 0) = 0 AND ${SLEEP_DEDUP_WHERE} AND s.user_id = ? ORDER BY s.date DESC LIMIT 1 OFFSET 1`,
  );
  return row ?? null;
}

export function getSleepTrend(userId: number, days: number): SleepRow[] {
  const limit = safeDays(days);
  const rows = forUser(userId).all<SleepRow>(
    `SELECT ${SLEEP_COLUMNS} FROM sleep s WHERE COALESCE(s.nap, 0) = 0 AND ${SLEEP_DEDUP_WHERE} AND s.user_id = ? ORDER BY s.date DESC LIMIT ${limit}`,
  );
  return rows.reverse();
}

export function getSleepRange(
  userId: number,
  startDate: string,
  endDate: string,
): SleepRow[] {
  const range = dateRangeClause(startDate, endDate);
  return forUser(userId).all<SleepRow>(
    `SELECT ${SLEEP_COLUMNS} FROM sleep s WHERE COALESCE(s.nap, 0) = 0 AND ${range.clause} AND ${SLEEP_DEDUP_WHERE} AND s.user_id = ? ORDER BY s.date ASC`,
    ...range.params,
  );
}

export function getFullSleepTrend(userId: number, days: number): SleepRow[] {
  const limit = safeDays(days);
  return forUser(userId)
    .all<SleepRow>(
      `SELECT ${SLEEP_COLUMNS} FROM sleep s WHERE COALESCE(s.nap, 0) = 0 AND ${SLEEP_DEDUP_WHERE} AND s.user_id = ? ORDER BY s.date DESC LIMIT ${limit}`,
    )
    .reverse();
}

export function getNaps(
  userId: number,
  startDate: string,
  endDate: string,
): NapRow[] {
  const range = dateRangeClause(startDate, endDate);
  return forUser(userId).all<NapRow>(
    `SELECT ${NAP_COLUMNS} FROM sleep WHERE COALESCE(nap, 0) = 1 AND ${range.clause} AND user_id = ? ORDER BY date ASC`,
    ...range.params,
  );
}

export function getRecentNaps(userId: number, days: number): NapRow[] {
  const limit = safeDays(days);
  const rows = forUser(userId).all<NapRow>(
    `SELECT ${NAP_COLUMNS} FROM sleep WHERE COALESCE(nap, 0) = 1 AND user_id = ? ORDER BY date DESC LIMIT ${limit}`,
  );
  return rows.reverse();
}
