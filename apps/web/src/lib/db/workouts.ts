import "server-only";
import { dateRangeClause } from "./connection";
import { forUser } from "./scoped";

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
  // UTC ISO timestamps pulled from raw JSON. Local-time variants
  // (`start_local`/`end_local`) are derived at the coach-tool boundary using
  // the user's IANA tz from `user_settings`; rows surfaced to the dashboard
  // page don't need them and they remain optional on the type.
  start_utc: string | null;
  end_utc: string | null;
  start_local?: string | null;
  end_local?: string | null;
};

const WORKOUT_COLUMNS =
  "id, date, sport, duration_sec, avg_hr, max_hr, strain, kilojoule, distance_m, zone_0_ms, zone_1_ms, zone_2_ms, zone_3_ms, zone_4_ms, zone_5_ms, json_extract(raw, '$.start') AS start_utc, json_extract(raw, '$.end') AS end_utc";

// Workouts run 1-3/day, so 500 = ~6 months — covers any reasonable single-query use.
const DEFAULT_WORKOUTS_LIMIT = 50;
const MAX_WORKOUTS_LIMIT = 500;

export function sanitizeLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_WORKOUTS_LIMIT;
  }
  const floored = Math.floor(limit);
  if (floored <= 0) return DEFAULT_WORKOUTS_LIMIT;
  return Math.min(floored, MAX_WORKOUTS_LIMIT);
}

export function getWorkouts(userId: number, limit?: number): WorkoutRow[] {
  const safeLimit = sanitizeLimit(limit);
  return forUser(userId).all<WorkoutRow>(
    `SELECT ${WORKOUT_COLUMNS} FROM workouts WHERE user_id = ? ORDER BY date DESC LIMIT ${safeLimit}`,
  );
}

export type TodayWorkoutRow = WorkoutRow & {
  start_time: string | null;
};

export type TodayStrainAggregate = {
  total_kilojoule: number | null;
  workout_count: number;
  avg_hr: number | null;
  max_hr: number | null;
};

/**
 * Workouts whose user-local date == `today` (YYYY-MM-DD).
 *
 * Includes `start_time` lifted from the `raw` JSON column so the UI can show
 * "started at HH:mm" without a follow-up read. DESC order so the most recent
 * workout sits at the top of the list.
 */
export function getTodayWorkouts(
  userId: number,
  today: string,
): TodayWorkoutRow[] {
  return forUser(userId).all<TodayWorkoutRow>(
    `SELECT ${WORKOUT_COLUMNS}, json_extract(raw, '$.start') AS start_time
     FROM workouts WHERE date = ? AND user_id = ? ORDER BY start_time DESC`,
    today,
  );
}

/**
 * Aggregate of today's workouts: total kJ, count, and HR averages.
 * `avg_hr` is the average of per-workout averages (good enough for a tile),
 * `max_hr` is the actual max across all of today's workouts.
 */
export function getTodayStrainAggregate(
  userId: number,
  today: string,
): TodayStrainAggregate {
  const row = forUser(userId).get<{
    total_kj: number | null;
    n: number;
    avg_hr: number | null;
    max_hr: number | null;
  }>(
    `SELECT
       SUM(kilojoule) AS total_kj,
       COUNT(*) AS n,
       AVG(avg_hr) AS avg_hr,
       MAX(max_hr) AS max_hr
     FROM workouts WHERE date = ? AND user_id = ?`,
    today,
  );
  return {
    total_kilojoule: row?.total_kj ?? null,
    workout_count: row?.n ?? 0,
    avg_hr: row?.avg_hr ?? null,
    max_hr: row?.max_hr ?? null,
  };
}

/**
 * Single workout by its primary key, scoped to the owner. Returns `undefined`
 * when the id is unknown OR belongs to another user — callers map that to a
 * 404 (`notFound()`), so cross-tenant ids are indistinguishable from missing.
 */
export function getWorkoutById(
  userId: number,
  id: string,
): WorkoutRow | undefined {
  return forUser(userId).get<WorkoutRow>(
    `SELECT ${WORKOUT_COLUMNS} FROM workouts WHERE id = ? AND user_id = ?`,
    id,
  );
}

// Per-second HR stream downsampled by the HealthKit ingest (see
// docs/design/healthkit-workouts/CONTRACT.md). `bpm[i]` is the HR at
// `start_offset_sec + i*interval_sec` seconds in; nulls mark gaps.
export type WorkoutHrSeries = {
  interval_sec: number;
  start_offset_sec: number;
  bpm: (number | null)[];
};

/**
 * Parsed HR stream for a workout, or `null` when absent.
 *
 * The `hr_series` column is added by the HealthKit ingest migration (T1) and
 * may not exist in older schemas — this tolerates a missing column gracefully
 * (PRAGMA gate) so the route builds/runs before that migration lands. Goes
 * through `forUser().read()` so the manual prepared statement stays tenant-
 * scoped (we bind `user_id` ourselves).
 */
export function getWorkoutHrSeries(
  userId: number,
  id: string,
): WorkoutHrSeries | null {
  return (
    forUser(userId).read((db, uid) => {
      const hasColumn = (
        db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]
      ).some((c) => c.name === "hr_series");
      if (!hasColumn) return null;
      const row = db
        .prepare("SELECT hr_series FROM workouts WHERE id = ? AND user_id = ?")
        .get(id, uid) as { hr_series: string | null } | undefined;
      if (!row?.hr_series) return null;
      try {
        const parsed = JSON.parse(row.hr_series) as WorkoutHrSeries;
        if (!parsed || !Array.isArray(parsed.bpm)) return null;
        return parsed;
      } catch {
        return null;
      }
    }) ?? null
  );
}

export type WorkoutsRangeResult = {
  rows: WorkoutRow[];
  truncated: boolean;
  total_count: number;
};

// Caps Coach `query_workouts` payloads. Without this, a 5-year range from the
// LLM dumps every workout into the tool result and balloons token cost.
// Fetches LIMIT+1 so a count > LIMIT trips truncated without a separate
// COUNT(*) round-trip; total_count then resolves via COUNT only when needed.
export function getWorkoutsRange(
  userId: number,
  startDate: string,
  endDate: string,
): WorkoutsRangeResult {
  const range = dateRangeClause(startDate, endDate);
  const fetched = forUser(userId).all<WorkoutRow>(
    `SELECT ${WORKOUT_COLUMNS} FROM workouts WHERE ${range.clause} AND user_id = ? ORDER BY date DESC LIMIT ${MAX_WORKOUTS_LIMIT + 1}`,
    ...range.params,
  );

  if (fetched.length <= MAX_WORKOUTS_LIMIT) {
    return {
      rows: fetched,
      truncated: false,
      total_count: fetched.length,
    };
  }

  const rows = fetched.slice(0, MAX_WORKOUTS_LIMIT);
  const countRow = forUser(userId).get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM workouts WHERE ${range.clause} AND user_id = ?`,
    ...range.params,
  );
  return {
    rows,
    truncated: true,
    total_count: countRow?.c ?? rows.length,
  };
}
