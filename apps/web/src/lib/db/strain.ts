import "server-only";
import { TREND_MAX_POINTS, dateRangeClause, safeDays, sampledTrendSql } from "./connection";
import { forUser } from "./scoped";

export type CycleRow = {
  date: string;
  strain: number | null;
  kilojoule: number | null;
  avg_hr: number | null;
  max_hr: number | null;
};

const CYCLE_COLUMNS = "date, strain, kilojoule, avg_hr, max_hr";

export function getLatestCycle(userId: number): CycleRow | null {
  const row = forUser(userId).get<CycleRow>(
    `SELECT ${CYCLE_COLUMNS} FROM cycles WHERE user_id = ? ORDER BY date DESC LIMIT 1`,
  );
  return row ?? null;
}

export function getPreviousCycle(userId: number): CycleRow | null {
  const row = forUser(userId).get<CycleRow>(
    `SELECT ${CYCLE_COLUMNS} FROM cycles WHERE user_id = ? ORDER BY date DESC LIMIT 1 OFFSET 1`,
  );
  return row ?? null;
}

export function getStrainTrend(userId: number, days: number): CycleRow[] {
  const limit = safeDays(days);
  const rows = forUser(userId).all<CycleRow>(
    `SELECT ${CYCLE_COLUMNS} FROM cycles WHERE user_id = ? ORDER BY date DESC LIMIT ${limit}`,
  );
  return rows.reverse();
}

/** Same rows as `getStrainTrend`, downsampled in SQL to ~`maxPoints` (latest two kept). */
export function getStrainTrendSampled(
  userId: number,
  days: number,
  maxPoints: number = TREND_MAX_POINTS,
): CycleRow[] {
  const limit = safeDays(days);
  return forUser(userId).all<CycleRow>(
    sampledTrendSql(
      CYCLE_COLUMNS,
      `SELECT ${CYCLE_COLUMNS} FROM cycles WHERE user_id = ? ORDER BY date DESC LIMIT ${limit}`,
      maxPoints,
    ),
  );
}

export function getStrainRange(
  userId: number,
  startDate: string,
  endDate: string,
): CycleRow[] {
  const range = dateRangeClause(startDate, endDate);
  return forUser(userId).all<CycleRow>(
    `SELECT ${CYCLE_COLUMNS} FROM cycles WHERE ${range.clause} AND user_id = ? ORDER BY date ASC`,
    ...range.params,
  );
}
