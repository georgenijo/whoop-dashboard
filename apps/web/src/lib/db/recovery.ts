import "server-only";
import { dateRangeClause, hasTable, safeQuery } from "./connection";

export type RecoveryRow = {
  date: string;
  recovery_score: number | null;
  hrv: number | null;
  rhr: number | null;
  spo2: number | null;
  skin_temp: number | null;
};

export function getLatestRecovery(): RecoveryRow | null {
  return safeQuery((db) => {
    if (!hasTable(db, "recovery")) return null;
    const row = db
      .prepare(
        "SELECT date, recovery_score, hrv, rhr, spo2, skin_temp FROM recovery ORDER BY date DESC LIMIT 1"
      )
      .get() as RecoveryRow | undefined;
    return row ?? null;
  });
}

export function getPreviousRecovery(): RecoveryRow | null {
  return safeQuery((db) => {
    if (!hasTable(db, "recovery")) return null;
    const row = db
      .prepare(
        "SELECT date, recovery_score, hrv, rhr, spo2, skin_temp FROM recovery ORDER BY date DESC LIMIT 1 OFFSET 1"
      )
      .get() as RecoveryRow | undefined;
    return row ?? null;
  });
}

export function getRecoveryTrend(days: number): RecoveryRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "recovery")) return [];
      const rows = db
        .prepare(
          "SELECT date, recovery_score, hrv, rhr, spo2, skin_temp FROM recovery ORDER BY date DESC LIMIT ?"
        )
        .all(days) as RecoveryRow[];
      return rows.reverse();
    }) ?? []
  );
}

export function getRecoveryRange(startDate: string, endDate: string): RecoveryRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "recovery")) return [];
      const range = dateRangeClause(startDate, endDate);
      return db
        .prepare(
          `SELECT date, recovery_score, hrv, rhr, spo2, skin_temp FROM recovery WHERE ${range.clause} ORDER BY date ASC`
        )
        .all(...range.params) as RecoveryRow[];
    }) ?? []
  );
}

export type DayOfWeekRecoveryRow = {
  dow: number;
  avg: number;
  count: number;
};

export function getRecoveryByDayOfWeek(): DayOfWeekRecoveryRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "recovery")) return [];
      return db
        .prepare(
          `SELECT CAST(strftime('%w', date) AS INTEGER) AS dow,
                  AVG(recovery_score) AS avg,
                  COUNT(*) AS count
           FROM recovery
           WHERE recovery_score IS NOT NULL
             AND date >= date('now', '-90 days')
           GROUP BY dow
           ORDER BY dow`
        )
        .all() as DayOfWeekRecoveryRow[];
    }) ?? []
  );
}
