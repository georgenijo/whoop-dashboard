import "server-only";
import { dateRangeClause } from "./connection";
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

/**
 * Sanitize a `days` LIMIT value so we can safely inline it as a literal in
 * SQL. Inlining lets `user_id = ?` remain the trailing placeholder — the
 * wrapper's binding convention. The alternative (placing LIMIT before
 * user_id) creates a positional collision with the wrapper-appended param.
 */
function safeDays(days: number): number {
  if (!Number.isFinite(days)) return 30;
  const n = Math.floor(days);
  if (n <= 0) return 30;
  // Hard cap to keep degenerate inputs from melting the DB; the highest
  // page-level use today is 365 (year view).
  return Math.min(n, 3650);
}

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
