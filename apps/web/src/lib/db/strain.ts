import "server-only";
import { dateRangeClause, hasTable, safeQuery } from "./connection";

export type CycleRow = {
  date: string;
  strain: number | null;
  kilojoule: number | null;
  avg_hr: number | null;
  max_hr: number | null;
};

export function getLatestCycle(): CycleRow | null {
  return safeQuery((db) => {
    if (!hasTable(db, "cycles")) return null;
    const row = db
      .prepare(
        "SELECT date, strain, kilojoule, avg_hr, max_hr FROM cycles ORDER BY date DESC LIMIT 1"
      )
      .get() as CycleRow | undefined;
    return row ?? null;
  });
}

export function getPreviousCycle(): CycleRow | null {
  return safeQuery((db) => {
    if (!hasTable(db, "cycles")) return null;
    const row = db
      .prepare(
        "SELECT date, strain, kilojoule, avg_hr, max_hr FROM cycles ORDER BY date DESC LIMIT 1 OFFSET 1"
      )
      .get() as CycleRow | undefined;
    return row ?? null;
  });
}

export function getStrainTrend(days: number): CycleRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "cycles")) return [];
      const rows = db
        .prepare(
          "SELECT date, strain, kilojoule, avg_hr, max_hr FROM cycles ORDER BY date DESC LIMIT ?"
        )
        .all(days) as CycleRow[];
      return rows.reverse();
    }) ?? []
  );
}

export function getStrainRange(startDate: string, endDate: string): CycleRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "cycles")) return [];
      const range = dateRangeClause(startDate, endDate);
      return db
        .prepare(
          `SELECT date, strain, kilojoule, avg_hr, max_hr FROM cycles WHERE ${range.clause} ORDER BY date ASC`
        )
        .all(...range.params) as CycleRow[];
    }) ?? []
  );
}
