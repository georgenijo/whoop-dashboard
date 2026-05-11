import "server-only";
import { dateRangeClause, safeDays } from "./connection";
import { forUser } from "./scoped";

export type RecoveryRow = {
  date: string;
  recovery_score: number | null;
  hrv: number | null;
  rhr: number | null;
  spo2: number | null;
  skin_temp: number | null;
};

const RECOVERY_COLUMNS = "date, recovery_score, hrv, rhr, spo2, skin_temp";

export function getLatestRecovery(userId: number): RecoveryRow | null {
  const row = forUser(userId).get<RecoveryRow>(
    `SELECT ${RECOVERY_COLUMNS} FROM recovery WHERE user_id = ? ORDER BY date DESC LIMIT 1`,
  );
  return row ?? null;
}

export function getPreviousRecovery(userId: number): RecoveryRow | null {
  const row = forUser(userId).get<RecoveryRow>(
    `SELECT ${RECOVERY_COLUMNS} FROM recovery WHERE user_id = ? ORDER BY date DESC LIMIT 1 OFFSET 1`,
  );
  return row ?? null;
}

export function getRecoveryTrend(userId: number, days: number): RecoveryRow[] {
  const limit = safeDays(days);
  const rows = forUser(userId).all<RecoveryRow>(
    `SELECT ${RECOVERY_COLUMNS} FROM recovery WHERE user_id = ? ORDER BY date DESC LIMIT ${limit}`,
  );
  return rows.reverse();
}

export function getRecoveryRange(
  userId: number,
  startDate: string,
  endDate: string,
): RecoveryRow[] {
  const range = dateRangeClause(startDate, endDate);
  return forUser(userId).all<RecoveryRow>(
    `SELECT ${RECOVERY_COLUMNS} FROM recovery WHERE ${range.clause} AND user_id = ? ORDER BY date ASC`,
    ...range.params,
  );
}

export type DayOfWeekRecoveryRow = {
  dow: number;
  avg: number;
  count: number;
};

export function getRecoveryByDayOfWeek(
  userId: number,
): DayOfWeekRecoveryRow[] {
  return forUser(userId).all<DayOfWeekRecoveryRow>(
    `SELECT CAST(strftime('%w', date) AS INTEGER) AS dow,
            AVG(recovery_score) AS avg,
            COUNT(*) AS count
     FROM recovery
     WHERE recovery_score IS NOT NULL
       AND date >= date('now', '-90 days')
       AND user_id = ?
     GROUP BY dow
     ORDER BY dow`,
  );
}
