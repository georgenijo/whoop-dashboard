import "server-only";
import { dateRangeClause } from "./connection";
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

// See recovery.ts for the rationale — inlined LIMIT keeps `user_id = ?` as
// the trailing placeholder the wrapper binds.
function safeDays(days: number): number {
  if (!Number.isFinite(days)) return 30;
  const n = Math.floor(days);
  if (n <= 0) return 30;
  return Math.min(n, 3650);
}

export function getLatestSleep(userId: number): SleepRow | null {
  const row = forUser(userId).get<SleepRow>(
    `SELECT ${SLEEP_COLUMNS} FROM sleep WHERE COALESCE(nap, 0) = 0 AND user_id = ? ORDER BY date DESC LIMIT 1`,
  );
  return row ?? null;
}

export function getPreviousSleep(userId: number): SleepRow | null {
  const row = forUser(userId).get<SleepRow>(
    `SELECT ${SLEEP_COLUMNS} FROM sleep WHERE COALESCE(nap, 0) = 0 AND user_id = ? ORDER BY date DESC LIMIT 1 OFFSET 1`,
  );
  return row ?? null;
}

export function getSleepTrend(userId: number, days: number): SleepRow[] {
  const limit = safeDays(days);
  const rows = forUser(userId).all<SleepRow>(
    `SELECT ${SLEEP_COLUMNS} FROM sleep WHERE COALESCE(nap, 0) = 0 AND user_id = ? ORDER BY date DESC LIMIT ${limit}`,
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
    `SELECT ${SLEEP_COLUMNS} FROM sleep WHERE COALESCE(nap, 0) = 0 AND ${range.clause} AND user_id = ? ORDER BY date ASC`,
    ...range.params,
  );
}

export function getFullSleepTrend(userId: number, days: number): SleepRow[] {
  const limit = safeDays(days);
  return forUser(userId)
    .all<SleepRow>(
      `SELECT ${SLEEP_COLUMNS} FROM sleep WHERE COALESCE(nap, 0) = 0 AND user_id = ? ORDER BY date DESC LIMIT ${limit}`,
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
