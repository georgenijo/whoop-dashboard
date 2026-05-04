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
  distance_m: number | null;
  zone_0_ms: number | null;
  zone_1_ms: number | null;
  zone_2_ms: number | null;
  zone_3_ms: number | null;
  zone_4_ms: number | null;
  zone_5_ms: number | null;
};

const WORKOUT_COLUMNS =
  "id, date, sport, duration_sec, avg_hr, max_hr, strain, kilojoule, distance_m, zone_0_ms, zone_1_ms, zone_2_ms, zone_3_ms, zone_4_ms, zone_5_ms";

export function getWorkouts(limit: number): WorkoutRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "workouts")) return [];
      return db
        .prepare(
          `SELECT ${WORKOUT_COLUMNS} FROM workouts ORDER BY date DESC LIMIT ?`
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
          `SELECT ${WORKOUT_COLUMNS} FROM workouts WHERE ${range.clause} ORDER BY date ASC`
        )
        .all(...range.params) as WorkoutRow[];
    }) ?? []
  );
}
