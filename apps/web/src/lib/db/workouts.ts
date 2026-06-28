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

/**
 * Provenance of a workout row: `'whoop'`, `'healthkit'`, or `null` when the
 * `source` column doesn't exist yet (pre-migration). PRAGMA-gated like
 * `getWorkoutHrSeries` so reads tolerate the older schema; tenant-scoped via
 * `forUser().read()`.
 */
export function getWorkoutSource(userId: number, id: string): string | null {
  return (
    forUser(userId).read((db, uid) => {
      const hasColumn = (
        db.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]
      ).some((c) => c.name === "source");
      if (!hasColumn) return null;
      const row = db
        .prepare("SELECT source FROM workouts WHERE id = ? AND user_id = ?")
        .get(id, uid) as { source: string | null } | undefined;
      return row?.source ?? null;
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

// ===========================================================================
// Stats / History aggregations (issue #428, T5)
//
// All reads route through forUser() so the CI scoped.test stays green. SUM()
// over an all-NULL column returns NULL in SQLite, which we deliberately let
// flow through as `null` — the Stats page renders "—" for absent metrics
// (e.g. distance, which Whoop straps don't capture) rather than a fake 0.
// ===========================================================================

export type AllTimeStats = {
  workouts: number;
  activeSeconds: number | null;
  distanceMeters: number | null;
  kilojoules: number | null;
};

/** Lifetime totals across every workout the user owns. */
export function getAllTimeStats(userId: number): AllTimeStats {
  const row = forUser(userId).get<{
    n: number;
    active_sec: number | null;
    dist_m: number | null;
    kj: number | null;
  }>(
    `SELECT COUNT(*) AS n,
            SUM(duration_sec) AS active_sec,
            SUM(distance_m) AS dist_m,
            SUM(kilojoule) AS kj
       FROM workouts WHERE user_id = ?`,
  );
  return {
    workouts: row?.n ?? 0,
    activeSeconds: row?.active_sec ?? null,
    distanceMeters: row?.dist_m ?? null,
    kilojoules: row?.kj ?? null,
  };
}

export type YoyMetric = {
  current: number | null;
  prior: number | null;
  /** current − prior; null when either side has no data. */
  delta: number | null;
  /** per-month values of the current period, for a sparkline. */
  spark: number[];
};

export type YearComparison = {
  year: number;
  priorYear: number;
  /** human label for the same-period window, e.g. "Jan 1 – Jun 28". */
  periodLabel: string;
  workouts: YoyMetric;
  distanceMeters: YoyMetric;
  activeHours: YoyMetric;
  calories: YoyMetric;
};

type PeriodAgg = {
  n: number;
  dist: number | null;
  dur: number | null;
  kj: number | null;
};

const KJ_PER_KCAL = 4.184;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Same-period year-over-year: Jan 1 → today's month/day of `year` vs the
 * identical window in `year - 1`. The MM-DD cutoff is derived from the server's
 * local "now" so the comparison is apples-to-apples mid-year.
 *
 * Each metric carries a per-month `spark` array (current period) for the
 * inline sparkline. Distance falls back to `null`/empty when no rows carry
 * `distance_m` — the page shows "—" rather than a fabricated 0.
 */
export function getYearComparison(userId: number, year: number): YearComparison {
  const now = new Date();
  const mmdd = `${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  const period = (y: number): PeriodAgg => {
    const row = forUser(userId).get<PeriodAgg>(
      `SELECT COUNT(*) AS n,
              SUM(distance_m) AS dist,
              SUM(duration_sec) AS dur,
              SUM(kilojoule) AS kj
         FROM workouts
        WHERE date >= ? AND date <= ? AND user_id = ?`,
      `${y}-01-01`,
      `${y}-${mmdd}`,
    );
    return {
      n: row?.n ?? 0,
      dist: row?.dist ?? null,
      dur: row?.dur ?? null,
      kj: row?.kj ?? null,
    };
  };

  const months = forUser(userId).all<{
    ym: string;
    n: number;
    dist: number | null;
    dur: number | null;
    kj: number | null;
  }>(
    `SELECT substr(date, 1, 7) AS ym,
            COUNT(*) AS n,
            SUM(distance_m) AS dist,
            SUM(duration_sec) AS dur,
            SUM(kilojoule) AS kj
       FROM workouts
      WHERE date >= ? AND date <= ? AND user_id = ?
      GROUP BY ym ORDER BY ym`,
    `${year}-01-01`,
    `${year}-${mmdd}`,
  );

  const cur = period(year);
  const prior = period(year - 1);

  const metric = (
    curVal: number | null,
    priorVal: number | null,
    spark: number[],
  ): YoyMetric => ({
    current: curVal,
    prior: priorVal,
    delta:
      curVal != null && priorVal != null ? curVal - priorVal : null,
    spark,
  });

  const distSpark = months.some((m) => m.dist != null)
    ? months.map((m) => m.dist ?? 0)
    : [];

  return {
    year,
    priorYear: year - 1,
    periodLabel: `Jan 1 – ${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    workouts: metric(cur.n, prior.n, months.map((m) => m.n)),
    distanceMeters: metric(cur.dist, prior.dist, distSpark),
    activeHours: metric(
      cur.dur != null ? cur.dur / 3600 : null,
      prior.dur != null ? prior.dur / 3600 : null,
      months.map((m) => (m.dur ?? 0) / 3600),
    ),
    calories: metric(
      cur.kj != null ? cur.kj / KJ_PER_KCAL : null,
      prior.kj != null ? prior.kj / KJ_PER_KCAL : null,
      months.map((m) => (m.kj ?? 0) / KJ_PER_KCAL),
    ),
  };
}

export type SportBreakdownRow = { sport: string; count: number };

/**
 * Workout counts per sport within `[startDate, endDate]`, busiest first.
 * Powers the "By sport" bar list; the range pills choose the window.
 */
export function getSportBreakdown(
  userId: number,
  startDate: string,
  endDate: string,
): SportBreakdownRow[] {
  return forUser(userId).all<SportBreakdownRow>(
    `SELECT COALESCE(sport, 'Unknown') AS sport, COUNT(*) AS count
       FROM workouts
      WHERE date >= ? AND date <= ? AND user_id = ?
      GROUP BY sport ORDER BY count DESC, sport ASC`,
    startDate,
    endDate,
  );
}

export type PersonalRecord = { value: number | null; meta: string | null };

export type PersonalRecords = {
  /** longest single session, in seconds */
  longestSessionSec: PersonalRecord;
  /** most kilojoules burned in one session */
  mostKilojoules: PersonalRecord;
  highestStrain: PersonalRecord;
  /** biggest training week, total seconds */
  biggestWeekSec: PersonalRecord;
  /** top max-HR across all sessions, bpm */
  topHr: PersonalRecord;
  /** most sessions logged in a single calendar month */
  mostSessionsMonth: PersonalRecord;
};

function fmtRecordDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtMonthLabel(ym: string): string {
  return new Date(ym + "-01T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/** All-time personal bests. Each record is `null` when no qualifying row exists. */
export function getPersonalRecords(userId: number): PersonalRecords {
  const single = (col: string): PersonalRecord => {
    const row = forUser(userId).get<{
      v: number;
      sport: string | null;
      date: string;
    }>(
      `SELECT ${col} AS v, sport, date
         FROM workouts
        WHERE ${col} IS NOT NULL AND user_id = ?
        ORDER BY ${col} DESC, date DESC LIMIT 1`,
    );
    if (!row) return { value: null, meta: null };
    return {
      value: row.v,
      meta: `${row.sport ?? "Unknown"} · ${fmtRecordDate(row.date)}`,
    };
  };

  const week = forUser(userId).get<{ total: number; first_day: string }>(
    `SELECT SUM(duration_sec) AS total, MIN(date) AS first_day
       FROM workouts
      WHERE duration_sec IS NOT NULL AND user_id = ?
      GROUP BY strftime('%Y-%W', date)
      ORDER BY total DESC LIMIT 1`,
  );

  const month = forUser(userId).get<{ ym: string; n: number }>(
    `SELECT substr(date, 1, 7) AS ym, COUNT(*) AS n
       FROM workouts
      WHERE user_id = ?
      GROUP BY ym ORDER BY n DESC, ym DESC LIMIT 1`,
  );

  return {
    longestSessionSec: single("duration_sec"),
    mostKilojoules: single("kilojoule"),
    highestStrain: single("strain"),
    biggestWeekSec: week
      ? { value: week.total, meta: `Week of ${fmtRecordDate(week.first_day)}` }
      : { value: null, meta: null },
    topHr: single("max_hr"),
    mostSessionsMonth: month
      ? { value: month.n, meta: fmtMonthLabel(month.ym) }
      : { value: null, meta: null },
  };
}

export type MonthlyRollupRow = {
  /** "YYYY-MM" */
  month: string;
  count: number;
  avgStrain: number | null;
  /** true for the current (in-progress) month or a partial first month. */
  partial: boolean;
};

/**
 * Per-month workout count + average strain for every month >= `fromDate`,
 * oldest first. Powers the year-over-year trend chart. A month is `partial`
 * when it's the current calendar month, or the earliest month in the series
 * whose data doesn't start on the 1st (the Dec-2025 backfill boundary).
 */
export function getMonthlyRollup(
  userId: number,
  fromDate: string,
): MonthlyRollupRow[] {
  const rows = forUser(userId).all<{
    ym: string;
    cnt: number;
    avg_strain: number | null;
    first_day: string;
  }>(
    `SELECT substr(date, 1, 7) AS ym,
            COUNT(*) AS cnt,
            AVG(strain) AS avg_strain,
            MIN(date) AS first_day
       FROM workouts
      WHERE date >= ? AND user_id = ?
      GROUP BY ym ORDER BY ym ASC`,
    fromDate,
  );

  const now = new Date();
  const currentYm = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;

  return rows.map((r, i) => ({
    month: r.ym,
    count: r.cnt,
    avgStrain: r.avg_strain,
    partial:
      r.ym === currentYm || (i === 0 && !r.first_day.endsWith("-01")),
  }));
}
