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

export function getLatestSleep(): SleepRow | null {
  return safeQuery((db) => {
    if (!hasTable(db, "sleep")) return null;
    const row = db
      .prepare(
        `SELECT ${SLEEP_COLUMNS} FROM sleep WHERE COALESCE(nap, 0) = 0 ORDER BY date DESC LIMIT 1`
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
        `SELECT ${SLEEP_COLUMNS} FROM sleep WHERE COALESCE(nap, 0) = 0 ORDER BY date DESC LIMIT 1 OFFSET 1`
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
          `SELECT ${SLEEP_COLUMNS} FROM sleep WHERE COALESCE(nap, 0) = 0 ORDER BY date DESC LIMIT ?`
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
          `SELECT ${SLEEP_COLUMNS} FROM sleep WHERE COALESCE(nap, 0) = 0 AND ${range.clause} ORDER BY date ASC`
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
          `SELECT ${SLEEP_COLUMNS} FROM sleep WHERE COALESCE(nap, 0) = 0 ORDER BY date DESC LIMIT ?`
        )
        .all(days) as SleepRow[];
    }) ?? []
  ).reverse();
}

export function getNaps(startDate: string, endDate: string): NapRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "sleep")) return [];
      const range = dateRangeClause(startDate, endDate);
      return db
        .prepare(
          `SELECT ${NAP_COLUMNS} FROM sleep WHERE COALESCE(nap, 0) = 1 AND ${range.clause} ORDER BY date ASC`
        )
        .all(...range.params) as NapRow[];
    }) ?? []
  );
}

export function getRecentNaps(days: number): NapRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "sleep")) return [];
      const rows = db
        .prepare(
          `SELECT ${NAP_COLUMNS} FROM sleep WHERE COALESCE(nap, 0) = 1 ORDER BY date DESC LIMIT ?`
        )
        .all(days) as NapRow[];
      return rows.reverse();
    }) ?? []
  );
}
