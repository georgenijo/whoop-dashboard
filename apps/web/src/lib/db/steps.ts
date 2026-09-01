import "server-only";
import { dateRangeClause } from "./connection";
import { forUser } from "./scoped";

export type StepsRow = {
  date: string;
  steps: number;
  source: string;
  updated_at: string;
};

const STEPS_COLUMNS = "date, steps, source, updated_at";

export function getLatestSteps(userId: number): StepsRow | null {
  const row = forUser(userId).get<StepsRow>(
    `SELECT ${STEPS_COLUMNS} FROM daily_steps WHERE user_id = ? ORDER BY date DESC LIMIT 1`,
  );
  return row ?? null;
}

export function getPreviousSteps(userId: number): StepsRow | null {
  const row = forUser(userId).get<StepsRow>(
    `SELECT ${STEPS_COLUMNS} FROM daily_steps WHERE user_id = ? ORDER BY date DESC LIMIT 1 OFFSET 1`,
  );
  return row ?? null;
}

export function getStepsRange(
  userId: number,
  startDate: string,
  endDate: string,
): StepsRow[] {
  const range = dateRangeClause(startDate, endDate);
  return forUser(userId).all<StepsRow>(
    `SELECT ${STEPS_COLUMNS} FROM daily_steps WHERE ${range.clause} AND user_id = ? ORDER BY date ASC`,
    ...range.params,
  );
}

export function getStepsTrend(
  userId: number,
  startDate: string,
  endDate: string,
): StepsRow[] {
  return getStepsRange(userId, startDate, endDate);
}
