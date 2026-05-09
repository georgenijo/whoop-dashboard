import "server-only";
import { openWrite } from "@/lib/db/connection";
import {
  WhoopAuthError,
  whoopGet,
  whoopGetAll,
  WhoopUpstreamError,
} from "@/lib/whoop/client";
import {
  cycleSummaryDate,
  parseDate,
  recoverySummaryDate,
  sleepSummaryDate,
  toLocalIso,
  upsertBodyMeasurement,
  workoutSummaryDate,
  type WhoopBodyMeasurement,
  type WhoopCycleRecord,
  type WhoopRecoveryRecord,
  type WhoopSleepRecord,
  type WhoopWorkoutRecord,
} from "@/lib/whoop/upsert";

// Do NOT delete sync/daily_sync.py until Phase 3-C ships and this path has
// been observed in prod for ~1 week (see issue #212 step 6).

export type SyncCounts = {
  recovery: number;
  sleep: number;
  cycles: number;
  workouts: number;
};

export type SyncResult = {
  success: boolean;
  latest_recovery_date: string | null;
  latest_sleep_date: string | null;
  latest_strain_date: string | null;
  /** Counts that passed `score_state === "SCORED"` and were upserted. */
  rows_inserted: SyncCounts;
  /**
   * Total records returned by the Whoop API per endpoint (pre-filter).
   * Matches the Python `len(data[...])` semantics used by `sync_logs`.
   */
  fetched_counts: SyncCounts;
  details: {
    window_days: number;
    fetch_ms: number;
    sync_db_ms: number;
    body_ms: number;
    fetch_breakdown: Record<string, number>;
    page_counts: Record<string, number>;
    summary_dates: number;
    body_error?: string;
  };
  error?: string;
  /**
   * Set when `signal` aborted AFTER the SQLite transaction committed but
   * before post-commit metadata work (body upsert, latest-date lookup) ran
   * to completion. Rows ARE persisted; the result is still `success: true`,
   * but skipped fields fall back to safe defaults (e.g. `latest_*_date: null`).
   */
  partial?: boolean;
};

const DEFAULT_DAYS = 7;

/**
 * Minimum interval between successful syncs. Shared between the manual
 * `/api/sync` route and the Coach `trigger_whoop_sync` tool so a single
 * fresh sync covers both surfaces.
 */
export const SYNC_COOLDOWN_MS = 5 * 60 * 1000;

function isoUtcRange(days: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/\.\d+Z$/, ".000Z");
  return { start: fmt(start), end: fmt(end) };
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

async function timed<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<{ label: string; result: T; durationMs: number }> {
  const t = Date.now();
  const result = await fn();
  return { label, result, durationMs: Date.now() - t };
}

type FetchedData = {
  cycles: WhoopCycleRecord[];
  recovery: WhoopRecoveryRecord[];
  sleep: WhoopSleepRecord[];
  workouts: WhoopWorkoutRecord[];
  body: WhoopBodyMeasurement | null;
};

async function fetchAllParallel(
  start: string,
  end: string,
  signal?: AbortSignal,
): Promise<{
  data: FetchedData;
  fetchBreakdown: Record<string, number>;
  pageCounts: Record<string, number>;
}> {
  const params = { start, end };
  const [
    bodyRes,
    cyclesRes,
    recoveryRes,
    sleepRes,
    workoutsRes,
  ] = await Promise.all([
    timed("body", async () =>
      whoopGet<WhoopBodyMeasurement>(`/v2/user/measurement/body`, { signal }),
    ),
    timed("cycles", async () =>
      whoopGetAll<WhoopCycleRecord>(`/v2/cycle`, params, { signal }),
    ),
    timed("recovery", async () =>
      whoopGetAll<WhoopRecoveryRecord>(`/v2/recovery`, params, { signal }),
    ),
    timed("sleep", async () =>
      whoopGetAll<WhoopSleepRecord>(`/v2/activity/sleep`, params, { signal }),
    ),
    timed("workouts", async () =>
      whoopGetAll<WhoopWorkoutRecord>(`/v2/activity/workout`, params, {
        signal,
      }),
    ),
  ]);

  return {
    data: {
      body: bodyRes.result ?? null,
      cycles: cyclesRes.result.records,
      recovery: recoveryRes.result.records,
      sleep: sleepRes.result.records,
      workouts: workoutsRes.result.records,
    },
    fetchBreakdown: {
      body: bodyRes.durationMs,
      cycles: cyclesRes.durationMs,
      recovery: recoveryRes.durationMs,
      sleep: sleepRes.durationMs,
      workouts: workoutsRes.durationMs,
    },
    pageCounts: {
      body: 1,
      cycles: cyclesRes.result.pageCount,
      recovery: recoveryRes.result.pageCount,
      sleep: sleepRes.result.pageCount,
      workouts: workoutsRes.result.pageCount,
    },
  };
}

const SUMMARY_SELECT_SQL = `
WITH day(date) AS (
    SELECT ?
),
workout_summary AS (
    SELECT date, COUNT(*) AS workouts_count
    FROM workouts
    WHERE date = ?
    GROUP BY date
)
SELECT
    day.date,
    CAST(recovery.recovery_score AS INTEGER) AS recovery_score,
    recovery.hrv AS hrv_ms,
    CAST(recovery.rhr AS INTEGER) AS resting_hr,
    CASE
        WHEN sleep.date IS NULL THEN NULL
        ELSE (
            COALESCE(sleep.light_ms, 0)
            + COALESCE(sleep.deep_ms, 0)
            + COALESCE(sleep.rem_ms, 0)
        ) / 3600000.0
    END AS sleep_hours,
    sleep.efficiency AS sleep_efficiency,
    CAST(sleep.performance AS INTEGER) AS sleep_performance,
    cycles.strain AS day_strain,
    cycles.max_hr,
    cycles.avg_hr,
    cycles.kilojoule AS kilojoules,
    COALESCE(workout_summary.workouts_count, 0) AS workouts_count
FROM day
LEFT JOIN recovery ON recovery.date = day.date
LEFT JOIN sleep ON sleep.date = day.date AND COALESCE(sleep.nap, 0) = 0
LEFT JOIN cycles ON cycles.date = day.date
LEFT JOIN workout_summary ON workout_summary.date = day.date
`;

const SUMMARY_INSERT_SQL = `
INSERT OR REPLACE INTO daily_summary (
  date, recovery_score, hrv_ms, resting_hr, sleep_hours, sleep_efficiency,
  sleep_performance, day_strain, max_hr, avg_hr, kilojoules, workouts_count
) VALUES (
  @date, @recovery_score, @hrv_ms, @resting_hr, @sleep_hours, @sleep_efficiency,
  @sleep_performance, @day_strain, @max_hr, @avg_hr, @kilojoules, @workouts_count
)
`;

function syncedDates(data: FetchedData): string[] {
  const dates = new Set<string>();
  for (const r of data.recovery) {
    if (r.score_state === "SCORED") dates.add(recoverySummaryDate(r));
  }
  for (const r of data.cycles) {
    if (r.score_state === "SCORED") dates.add(cycleSummaryDate(r));
  }
  for (const r of data.sleep) {
    if (r.score_state === "SCORED") dates.add(sleepSummaryDate(r));
  }
  // Workouts are not gated on score_state in Python (require_scored=False),
  // so we mirror that here.
  for (const r of data.workouts) {
    dates.add(workoutSummaryDate(r));
  }
  return [...dates].sort();
}

/**
 * Apply all upserts (recovery / cycles / sleep / workouts + daily_summary
 * recompute) inside a single connection + transaction. If the caller's
 * AbortSignal fires during the synchronous transaction body, the throw
 * escapes the transaction wrapper and better-sqlite3 rolls back.
 *
 * Body measurement and the latest_*_date reads run separately *after* this
 * function returns — see `runWhoopSync` for those.
 */
function persistAll(data: FetchedData, signal?: AbortSignal): SyncCounts {
  const counts: SyncCounts = {
    recovery: 0,
    sleep: 0,
    cycles: 0,
    workouts: 0,
  };
  const db = openWrite();
  if (!db) throw new Error("DB unavailable (no whoop_data.db at expected path)");
  try {
    const recoveryStmt = db.prepare(`
      INSERT OR REPLACE INTO recovery
        (date, recovery_score, hrv, rhr, spo2, skin_temp, raw)
      VALUES
        (@date, @recovery_score, @hrv, @rhr, @spo2, @skin_temp, @raw)
    `);
    const cyclesStmt = db.prepare(`
      INSERT OR REPLACE INTO cycles
        (date, strain, kilojoule, avg_hr, max_hr, raw)
      VALUES
        (@date, @strain, @kilojoule, @avg_hr, @max_hr, @raw)
    `);
    const sleepStmt = db.prepare(`
      INSERT OR REPLACE INTO sleep
        (date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms,
         performance, efficiency, consistency, respiratory_rate,
         disturbances, cycles, nap,
         need_from_baseline_ms, need_from_debt_ms, need_from_strain_ms, need_from_nap_ms,
         start_local, end_local,
         raw)
      VALUES
        (@date, @in_bed_ms, @light_ms, @deep_ms, @rem_ms, @awake_ms, @sleep_need_ms,
         @performance, @efficiency, @consistency, @respiratory_rate,
         @disturbances, @cycles, @nap,
         @need_from_baseline_ms, @need_from_debt_ms, @need_from_strain_ms, @need_from_nap_ms,
         @start_local, @end_local,
         @raw)
    `);
    const workoutsStmt = db.prepare(`
      INSERT OR REPLACE INTO workouts
        (id, date, sport, duration_sec, avg_hr, max_hr, strain, kilojoule,
         distance_m, zone_0_ms, zone_1_ms, zone_2_ms, zone_3_ms, zone_4_ms, zone_5_ms, raw)
      VALUES
        (@id, @date, @sport, @duration_sec, @avg_hr, @max_hr, @strain, @kilojoule,
         @distance_m, @zone_0_ms, @zone_1_ms, @zone_2_ms, @zone_3_ms, @zone_4_ms, @zone_5_ms, @raw)
    `);
    const summarySelect = db.prepare(SUMMARY_SELECT_SQL);
    const summaryInsert = db.prepare(SUMMARY_INSERT_SQL);

    const persist = db.transaction(() => {
      checkAborted(signal);
      for (const r of data.recovery) {
        if (r.score_state !== "SCORED" || !r.score) continue;
        recoveryStmt.run({
          date: parseDate(r.created_at),
          recovery_score: r.score.recovery_score,
          hrv: r.score.hrv_rmssd_milli,
          rhr: r.score.resting_heart_rate,
          spo2: r.score.spo2_percentage ?? null,
          skin_temp: r.score.skin_temp_celsius ?? null,
          raw: JSON.stringify(r),
        });
        counts.recovery += 1;
      }
      checkAborted(signal);
      for (const r of data.cycles) {
        if (r.score_state !== "SCORED" || !r.score) continue;
        cyclesStmt.run({
          date: parseDate(r.start),
          strain: r.score.strain,
          kilojoule: r.score.kilojoule,
          avg_hr: r.score.average_heart_rate,
          max_hr: r.score.max_heart_rate,
          raw: JSON.stringify(r),
        });
        counts.cycles += 1;
      }
      checkAborted(signal);
      for (const r of data.sleep) {
        if (r.score_state !== "SCORED" || !r.score) continue;
        const ss = r.score.stage_summary;
        const sn = r.score.sleep_needed;
        sleepStmt.run({
          date: parseDate(r.start),
          in_bed_ms: ss.total_in_bed_time_milli,
          light_ms: ss.total_light_sleep_time_milli,
          deep_ms: ss.total_slow_wave_sleep_time_milli,
          rem_ms: ss.total_rem_sleep_time_milli,
          awake_ms: ss.total_awake_time_milli,
          sleep_need_ms:
            sn.baseline_milli +
            sn.need_from_sleep_debt_milli +
            sn.need_from_recent_strain_milli +
            sn.need_from_recent_nap_milli,
          performance: r.score.sleep_performance_percentage ?? null,
          efficiency: r.score.sleep_efficiency_percentage ?? null,
          consistency: r.score.sleep_consistency_percentage ?? null,
          respiratory_rate: r.score.respiratory_rate ?? null,
          disturbances: ss.disturbance_count,
          cycles: ss.sleep_cycle_count,
          nap: r.nap ? 1 : 0,
          need_from_baseline_ms: sn.baseline_milli,
          need_from_debt_ms: sn.need_from_sleep_debt_milli,
          need_from_strain_ms: sn.need_from_recent_strain_milli,
          need_from_nap_ms: sn.need_from_recent_nap_milli,
          start_local: toLocalIso(r.start, r.timezone_offset),
          end_local: toLocalIso(r.end, r.timezone_offset),
          raw: JSON.stringify(r),
        });
        counts.sleep += 1;
      }
      checkAborted(signal);
      for (const r of data.workouts) {
        if (r.score_state !== "SCORED" || !r.score) continue;
        const zd = r.score.zone_durations;
        const durationSec =
          (new Date(r.end).getTime() - new Date(r.start).getTime()) / 1000;
        workoutsStmt.run({
          id: r.id,
          date: parseDate(r.start),
          sport: r.sport_name ?? "Unknown",
          duration_sec: durationSec,
          avg_hr: r.score.average_heart_rate,
          max_hr: r.score.max_heart_rate,
          strain: r.score.strain,
          kilojoule: r.score.kilojoule,
          distance_m: r.score.distance_meter ?? null,
          zone_0_ms: zd.zone_zero_milli,
          zone_1_ms: zd.zone_one_milli,
          zone_2_ms: zd.zone_two_milli,
          zone_3_ms: zd.zone_three_milli,
          zone_4_ms: zd.zone_four_milli,
          zone_5_ms: zd.zone_five_milli,
          raw: JSON.stringify(r),
        });
        counts.workouts += 1;
      }
      checkAborted(signal);
      // Recompute daily_summary for all dates touched by this sync.
      for (const date of syncedDates(data)) {
        const row = summarySelect.get(date, date) as
          | Record<string, unknown>
          | undefined;
        if (row) summaryInsert.run(row);
      }
    });
    persist();
    return counts;
  } finally {
    db.close();
  }
}

type LatestDates = {
  recovery: string | null;
  sleep: string | null;
  strain: string | null;
};

/** Single read open + 3 queries; called once per sync (success or error). */
function latestDates(): LatestDates {
  const db = openWrite();
  if (!db) return { recovery: null, sleep: null, strain: null };
  try {
    const pick = (sql: string): string | null => {
      const row = db.prepare(sql).get() as { date: string } | undefined;
      return row?.date ?? null;
    };
    return {
      recovery: pick("SELECT date FROM recovery ORDER BY date DESC LIMIT 1"),
      sleep: pick(
        "SELECT date FROM sleep WHERE COALESCE(nap, 0) = 0 ORDER BY date DESC LIMIT 1",
      ),
      strain: pick("SELECT date FROM cycles ORDER BY date DESC LIMIT 1"),
    };
  } finally {
    db.close();
  }
}

export async function runWhoopSync(
  opts: { days?: number; signal?: AbortSignal } = {},
): Promise<SyncResult> {
  const days = opts.days ?? DEFAULT_DAYS;
  const { start, end } = isoUtcRange(days);
  const details: SyncResult["details"] = {
    window_days: days,
    fetch_ms: 0,
    sync_db_ms: 0,
    body_ms: 0,
    fetch_breakdown: {},
    page_counts: {},
    summary_dates: 0,
  };
  const baseResult: SyncResult = {
    success: false,
    latest_recovery_date: null,
    latest_sleep_date: null,
    latest_strain_date: null,
    rows_inserted: { recovery: 0, sleep: 0, cycles: 0, workouts: 0 },
    fetched_counts: { recovery: 0, sleep: 0, cycles: 0, workouts: 0 },
    details,
  };

  let committed = false;
  let committedCounts: SyncCounts | null = null;
  let committedFetched: SyncCounts | null = null;
  let committedData: FetchedData | null = null;

  try {
    checkAborted(opts.signal);

    const fetchT0 = Date.now();
    const { data, fetchBreakdown, pageCounts } = await fetchAllParallel(
      start,
      end,
      opts.signal,
    );
    details.fetch_ms = Date.now() - fetchT0;
    details.fetch_breakdown = fetchBreakdown;
    details.page_counts = pageCounts;

    checkAborted(opts.signal);

    const dbT0 = Date.now();
    const counts = persistAll(data, opts.signal);
    details.sync_db_ms = Date.now() - dbT0;
    committed = true;
    committedCounts = counts;
    committedData = data;
    committedFetched = {
      recovery: data.recovery.length,
      sleep: data.sleep.length,
      cycles: data.cycles.length,
      workouts: data.workouts.length,
    };

    // Body measurement is deduped against the latest stored row, so it's safe
    // to run after the main transaction. Failures here surface in details
    // (sync_logs) but don't fail the sync — recovery / sleep / cycles /
    // workouts are already committed.
    const bodyT0 = Date.now();
    try {
      checkAborted(opts.signal);
      upsertBodyMeasurement(data.body);
    } catch (err) {
      details.body_error =
        err instanceof Error ? err.message : String(err);
    }
    details.body_ms = Date.now() - bodyT0;
    details.summary_dates = syncedDates(data).length;

    checkAborted(opts.signal);

    const latest = latestDates();
    return {
      success: true,
      latest_recovery_date: latest.recovery,
      latest_sleep_date: latest.sleep,
      latest_strain_date: latest.strain,
      rows_inserted: counts,
      fetched_counts: committedFetched,
      details,
    };
  } catch (err) {
    // DOMException (e.g. AbortError) extends Error in Node 20+, so the
    // single Error-name check covers both branches.
    const isAbort = err instanceof Error && err.name === "AbortError";

    // Abort fired after the transaction committed: rows ARE in the DB, so
    // report success rather than misleading the caller (Coach surfaces
    // "sync failed" otherwise — see issue #242).
    if (isAbort && committed && committedCounts && committedFetched) {
      details.summary_dates = committedData
        ? syncedDates(committedData).length
        : details.summary_dates;
      return {
        success: true,
        latest_recovery_date: null,
        latest_sleep_date: null,
        latest_strain_date: null,
        rows_inserted: committedCounts,
        fetched_counts: committedFetched,
        details,
        partial: true,
      };
    }

    let message: string;
    if (isAbort) {
      message = "aborted";
    } else if (err instanceof WhoopAuthError) {
      message = `auth: ${err.message}`;
    } else if (err instanceof WhoopUpstreamError) {
      message = `upstream ${err.status}: ${err.message}`;
    } else if (err instanceof Error) {
      message = err.message;
    } else {
      message = String(err);
    }
    const latest = latestDates();
    return {
      ...baseResult,
      success: false,
      error: message,
      latest_recovery_date: latest.recovery,
      latest_sleep_date: latest.sleep,
      latest_strain_date: latest.strain,
    };
  }
}
