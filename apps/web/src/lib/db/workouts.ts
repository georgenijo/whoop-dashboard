import "server-only";
import { dateRangeClause, hasTable, safeQuery } from "./connection";

export type WorkoutRow = {
  id: string;
  date: string;
  sport: string | null;
  duration_sec: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  strain: number | null;
  kilojoule: number | null;
};

export function getWorkouts(limit: number): WorkoutRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "workouts")) return [];
      return db
        .prepare(
          "SELECT id, date, sport, duration_sec, avg_hr, max_hr, strain, kilojoule FROM workouts ORDER BY date DESC LIMIT ?"
        )
        .all(limit) as WorkoutRow[];
    }) ?? []
  );
}

export function getWorkoutsRange(startDate: string, endDate: string): WorkoutRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "workouts")) return [];
      const range = dateRangeClause(startDate, endDate);
      return db
        .prepare(
          `SELECT id, date, sport, duration_sec, avg_hr, max_hr, strain, kilojoule FROM workouts WHERE ${range.clause} ORDER BY date ASC`
        )
        .all(...range.params) as WorkoutRow[];
    }) ?? []
  );
}
