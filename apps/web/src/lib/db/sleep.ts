import "server-only";
import { dateRangeClause, hasTable, safeQuery } from "./connection";

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
  respiratory_rate: number | null;
};

export function getLatestSleep(): SleepRow | null {
  return safeQuery((db) => {
    if (!hasTable(db, "sleep")) return null;
    const row = db
      .prepare(
        "SELECT date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms, performance, efficiency, consistency, disturbances, respiratory_rate FROM sleep WHERE nap = 0 ORDER BY date DESC LIMIT 1"
      )
      .get() as SleepRow | undefined;
    return row ?? null;
  });
}

export function getPreviousSleep(): SleepRow | null {
  return safeQuery((db) => {
    if (!hasTable(db, "sleep")) return null;
    const row = db
      .prepare(
        "SELECT date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms, performance, efficiency, consistency, disturbances, respiratory_rate FROM sleep WHERE nap = 0 ORDER BY date DESC LIMIT 1 OFFSET 1"
      )
      .get() as SleepRow | undefined;
    return row ?? null;
  });
}

export function getSleepTrend(days: number): SleepRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "sleep")) return [];
      const rows = db
        .prepare(
          "SELECT date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms, performance, efficiency, consistency, disturbances, respiratory_rate FROM sleep WHERE nap = 0 ORDER BY date DESC LIMIT ?"
        )
        .all(days) as SleepRow[];
      return rows.reverse();
    }) ?? []
  );
}

export function getSleepRange(startDate: string, endDate: string): SleepRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "sleep")) return [];
      const range = dateRangeClause(startDate, endDate);
      return db
        .prepare(
          `SELECT date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms, performance, efficiency, consistency, disturbances, respiratory_rate FROM sleep WHERE nap = 0 AND ${range.clause} ORDER BY date ASC`
        )
        .all(...range.params) as SleepRow[];
    }) ?? []
  );
}

export function getFullSleepTrend(days: number): SleepRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "sleep")) return [];
      return db
        .prepare(
          "SELECT date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms, performance, efficiency, consistency, disturbances, respiratory_rate FROM sleep WHERE nap = 0 ORDER BY date DESC LIMIT ?"
        )
        .all(days) as SleepRow[];
    }) ?? []
  ).reverse();
}
