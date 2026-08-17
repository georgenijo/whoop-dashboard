import "server-only";
import { openWrite } from "@/lib/db/connection";
import { getUserSettings } from "@/lib/db";
import { forUser } from "@/lib/db/scoped";
import { getSetting, setSetting } from "@/lib/db/settings";
import {
  getIntegration,
  setProviderUserId,
} from "@/lib/db/integrations";
import {
  getWhoopProfile,
  WhoopAuthError,
  whoopGet,
  whoopGetAll,
  WhoopUpstreamError,
} from "@/lib/whoop/client";
import { getValidAccessToken } from "@/lib/whoop/token";
import {
  cycleSummaryDate,
  parseDate,
  recoverySummaryDate,
  sleepSummaryDate,
  toLocalIso,
  upsertBodyMeasurement,
  upsertCyclesAndRecompute,
  workoutSummaryDate,
  type WhoopBodyMeasurement,
  type WhoopCycleRecord,
  type WhoopRecoveryRecord,
  type WhoopSleepRecord,
  type WhoopWorkoutRecord,
} from "@/lib/whoop/upsert";
import { forModule } from "@/lib/logger";

const log = forModule("sync");

export type SyncStage =
  | "refreshing_token"
  | "fetching_recovery"
  | "fetching_sleep"
  | "fetching_strain"
  | "fetching_workouts"
  | "fetching_body"
  | "upserting"
  | "computing_summary";

export type SyncProgressEvent = { stage: SyncStage; message?: string };

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
    /** SCORED sleep records this sync fetched but could not date (missing
     *  `end` — `sleepSummaryDate` throws rather than silently misfiling
     *  them; see its doc comment). Should be 0 in practice — every SCORED
     *  record carries `end` from the Whoop v2 API — but if it's ever
     *  nonzero, these records were skipped rather than written under a
     *  wrong-but-plausible date, and rather than failing the whole sync
     *  (recovery/cycles/workouts still commit). */
    sleep_missing_end_skipped: number;
    body_error?: string;
    /** Cycles reconcile (issue #415) outcome. Absent if it threw before
     *  producing a result (see `reconcile_error`), or if the one-time
     *  historical backfill ran on this sync (it already covers a strict
     *  superset of the routine band — see `cycles_backfill`). */
    reconcile?: ReconcileCyclesResult;
    reconcile_ms?: number;
    reconcile_error?: string;
    /** Present only on the single sync where the one-time historical
     *  cycles backfill (issue #415) ran. */
    cycles_backfill?: ReconcileCyclesResult;
    /** Present only on the single sync where the one-time sleep wake-day
     *  re-date backfill (issue #440) ran. */
    sleep_backfill?: SleepWakeDayBackfillResult;
    sleep_backfill_error?: string;
  };
  error?: string;
  /**
   * True when the SQLite transaction committed but post-commit metadata work
   * (body upsert, summary_dates count) was interrupted by an abort or post-
   * commit exception. Callers should treat `partial: true` as success — rows
   * ARE persisted — but should NOT rely on `details.body_ms`, `body_error`,
   * or `summary_dates` reflecting a fully-completed sync.
   * `latest_*_date` fields are still populated by a fresh read after commit.
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
  userId: number,
  start: string,
  end: string,
  signal?: AbortSignal,
  onProgress?: (e: SyncProgressEvent) => void,
): Promise<{
  data: FetchedData;
  fetchBreakdown: Record<string, number>;
  pageCounts: Record<string, number>;
}> {
  const params = { start, end };

  /** Fires `fetching_*` when this endpoint resolves — order in the emit
   * log reflects actual fetch latency, not source code order. */
  const reporting = <T>(stage: SyncStage, p: Promise<T>): Promise<T> =>
    onProgress ? p.then((r) => { onProgress({ stage }); return r; }) : p;

  // Defensive 401-retry inside `whoopGet` will force-refresh the token. The
  // pre-warm in `runWhoopSync` already covers the common case, but if a
  // token expires mid-fetch (revoked, edge cache stale, clock skew), this
  // path emits `refreshing_token` so the user/model still sees the event.
  const onTokenRefresh = onProgress
    ? () => onProgress({ stage: "refreshing_token" })
    : undefined;
  const fetchOpts = { userId, signal, onTokenRefresh };

  const [
    bodyRes,
    cyclesRes,
    recoveryRes,
    sleepRes,
    workoutsRes,
  ] = await Promise.all([
    reporting(
      "fetching_body",
      timed("body", async () =>
        whoopGet<WhoopBodyMeasurement>(`/v2/user/measurement/body`, fetchOpts),
      ),
    ),
    reporting(
      "fetching_strain",
      timed("cycles", async () =>
        whoopGetAll<WhoopCycleRecord>(`/v2/cycle`, params, fetchOpts),
      ),
    ),
    reporting(
      "fetching_recovery",
      timed("recovery", async () =>
        whoopGetAll<WhoopRecoveryRecord>(`/v2/recovery`, params, fetchOpts),
      ),
    ),
    reporting(
      "fetching_sleep",
      timed("sleep", async () =>
        whoopGetAll<WhoopSleepRecord>(`/v2/activity/sleep`, params, fetchOpts),
      ),
    ),
    reporting(
      "fetching_workouts",
      timed("workouts", async () =>
        whoopGetAll<WhoopWorkoutRecord>(`/v2/activity/workout`, params, fetchOpts),
      ),
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

// Phase D: per-user scoping on every CTE / join. Param order is shared with
// the duplicated copy in `whoop/upsert.ts:_recomputeInDb` — keep both in sync.
const SUMMARY_SELECT_SQL = `
WITH day(date) AS (
    SELECT ?
),
workout_summary AS (
    SELECT date, COUNT(*) AS workouts_count
    FROM workouts
    WHERE date = ? AND user_id = ?
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
LEFT JOIN recovery ON recovery.date = day.date AND recovery.user_id = ?
-- Deterministic one-row-per-date pick (issue #440): wake-day attribution
-- removes same-day collisions caused by the old start-day filing, but two
-- sleeps CAN still legitimately end on the same local date (wake 03:00,
-- sleep again, wake 09:00). Longest in_bed_ms wins; sleep_id breaks ties.
-- KEEP THIS SUBSELECT IN SYNC WITH upsert.ts's SELECT_DAILY_SUMMARY and with
-- db/sleep.ts's SLEEP_DEDUP_WHERE (same tie-break rule, three call sites).
LEFT JOIN (
    SELECT s.date, s.light_ms, s.deep_ms, s.rem_ms, s.efficiency, s.performance
    FROM sleep s
    WHERE COALESCE(s.nap, 0) = 0 AND s.user_id = ?
      AND s.sleep_id = (
        SELECT s2.sleep_id FROM sleep s2
        WHERE s2.user_id = s.user_id AND s2.date = s.date AND COALESCE(s2.nap, 0) = 0
        ORDER BY s2.in_bed_ms DESC, s2.sleep_id DESC
        LIMIT 1
      )
) sleep ON sleep.date = day.date
LEFT JOIN cycles ON cycles.date = day.date AND cycles.user_id = ?
LEFT JOIN workout_summary ON workout_summary.date = day.date
`;

const SUMMARY_INSERT_SQL = `
INSERT OR REPLACE INTO daily_summary (
  user_id, date, recovery_score, hrv_ms, resting_hr, sleep_hours, sleep_efficiency,
  sleep_performance, day_strain, max_hr, avg_hr, kilojoules, workouts_count
) VALUES (
  @user_id, @date, @recovery_score, @hrv_ms, @resting_hr, @sleep_hours, @sleep_efficiency,
  @sleep_performance, @day_strain, @max_hr, @avg_hr, @kilojoules, @workouts_count
)
`;

function syncedDates(data: FetchedData, tz: string): string[] {
  const dates = new Set<string>();
  for (const r of data.recovery) {
    if (r.score_state === "SCORED") dates.add(recoverySummaryDate(r, tz));
  }
  for (const r of data.cycles) {
    if (r.score_state === "SCORED") dates.add(cycleSummaryDate(r, tz));
  }
  for (const r of data.sleep) {
    if (r.score_state !== "SCORED") continue;
    // Mirrors persistAll's sleep loop: a SCORED record without `end` throws
    // from `sleepSummaryDate` (issue #440 review) rather than silently
    // misfiling it. persistAll already skips-and-counts it; this is purely
    // about not crashing the (separate, post-commit) `summary_dates` count
    // over the identical record.
    try {
      dates.add(sleepSummaryDate(r, tz));
    } catch {
      // already logged/counted by persistAll
    }
  }
  // Workouts are not gated on score_state in Python (require_scored=False),
  // so we mirror that here.
  for (const r of data.workouts) {
    dates.add(workoutSummaryDate(r, tz));
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
 *
 * A SCORED sleep record missing `end` makes `sleepSummaryDate` throw
 * (issue #440 review) — this loop catches that PER RECORD and skips just
 * that one, rather than letting it escape into the shared `db.transaction`
 * and roll back recovery/cycles/workouts too. This should never happen in
 * practice (every SCORED record carries `end`), but "one malformed sleep
 * record takes down the whole sync, every sync, until Whoop fixes its API"
 * is a worse failure mode than skipping the one record and surfacing the
 * count.
 */
function persistAll(
  data: FetchedData,
  userId: number,
  signal: AbortSignal | undefined,
  tz: string,
): { counts: SyncCounts; sleepMissingEndSkipped: number } {
  const counts: SyncCounts = {
    recovery: 0,
    sleep: 0,
    cycles: 0,
    workouts: 0,
  };
  let sleepMissingEndSkipped = 0;
  const skippedSleepRecords: { sleep_id: string; err: string }[] = [];
  const db = openWrite();
  if (!db) throw new Error("DB unavailable (no whoop_data.db at expected path)");
  try {
    const recoveryStmt = db.prepare(`
      INSERT OR REPLACE INTO recovery
        (user_id, date, recovery_score, hrv, rhr, spo2, skin_temp, raw)
      VALUES
        (@user_id, @date, @recovery_score, @hrv, @rhr, @spo2, @skin_temp, @raw)
    `);
    const cyclesStmt = db.prepare(`
      INSERT OR REPLACE INTO cycles
        (user_id, date, strain, kilojoule, avg_hr, max_hr, raw)
      VALUES
        (@user_id, @date, @strain, @kilojoule, @avg_hr, @max_hr, @raw)
    `);
    const sleepStmt = db.prepare(`
      INSERT OR REPLACE INTO sleep
        (user_id, sleep_id, date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms,
         performance, efficiency, consistency, respiratory_rate,
         disturbances, cycles, nap,
         need_from_baseline_ms, need_from_debt_ms, need_from_strain_ms, need_from_nap_ms,
         start_local, end_local,
         raw)
      VALUES
        (@user_id, @sleep_id, @date, @in_bed_ms, @light_ms, @deep_ms, @rem_ms, @awake_ms, @sleep_need_ms,
         @performance, @efficiency, @consistency, @respiratory_rate,
         @disturbances, @cycles, @nap,
         @need_from_baseline_ms, @need_from_debt_ms, @need_from_strain_ms, @need_from_nap_ms,
         @start_local, @end_local,
         @raw)
    `);
    const workoutsStmt = db.prepare(`
      INSERT OR REPLACE INTO workouts
        (user_id, id, date, sport, duration_sec, avg_hr, max_hr, strain, kilojoule,
         distance_m, zone_0_ms, zone_1_ms, zone_2_ms, zone_3_ms, zone_4_ms, zone_5_ms, raw)
      VALUES
        (@user_id, @id, @date, @sport, @duration_sec, @avg_hr, @max_hr, @strain, @kilojoule,
         @distance_m, @zone_0_ms, @zone_1_ms, @zone_2_ms, @zone_3_ms, @zone_4_ms, @zone_5_ms, @raw)
    `);
    const summarySelect = db.prepare(SUMMARY_SELECT_SQL);
    const summaryInsert = db.prepare(SUMMARY_INSERT_SQL);

    const persist = db.transaction(() => {
      checkAborted(signal);
      for (const r of data.recovery) {
        if (r.score_state !== "SCORED" || !r.score) continue;
        recoveryStmt.run({
          user_id: userId,
          date: parseDate(r.created_at, tz),
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
          user_id: userId,
          date: parseDate(r.start, tz),
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
        let date: string;
        try {
          date = sleepSummaryDate(r, tz);
        } catch (err) {
          // Should never happen — every SCORED record carries `end` — but
          // skip just this record rather than rolling back the whole
          // transaction (recovery/cycles/workouts) for a single bad row.
          // Logging happens AFTER `persist()` returns below, not here: the
          // logger persists warn+ events via its own `openWrite()` call
          // (`server_logs`), and calling that from inside this transaction
          // deadlocks against the write lock this same transaction already
          // holds (SQLITE_BUSY).
          sleepMissingEndSkipped += 1;
          skippedSleepRecords.push({
            sleep_id: r.id,
            err: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
        const ss = r.score.stage_summary;
        const sn = r.score.sleep_needed;
        sleepStmt.run({
          user_id: userId,
          sleep_id: r.id,
          date,
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
          user_id: userId,
          id: r.id,
          date: parseDate(r.start, tz),
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
      for (const date of syncedDates(data, tz)) {
        const row = summarySelect.get(
          date,
          date,
          userId,
          userId,
          userId,
          userId,
        ) as Record<string, unknown> | undefined;
        if (row) summaryInsert.run({ ...row, user_id: userId });
      }
    });
    persist();
    // Logged here, after the transaction committed — see the try/catch
    // above for why logging from inside it deadlocks.
    for (const skipped of skippedSleepRecords) {
      log.error(
        { user_id: userId, ...skipped },
        "sleep record skipped: missing end",
      );
    }
    return { counts, sleepMissingEndSkipped };
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
function latestDates(userId: number): LatestDates {
  const db = openWrite();
  if (!db) return { recovery: null, sleep: null, strain: null };
  try {
    const pick = (sql: string): string | null => {
      const row = db.prepare(sql).get(userId) as { date: string } | undefined;
      return row?.date ?? null;
    };
    return {
      recovery: pick(
        "SELECT date FROM recovery WHERE user_id = ? ORDER BY date DESC LIMIT 1",
      ),
      sleep: pick(
        "SELECT date FROM sleep WHERE COALESCE(nap, 0) = 0 AND user_id = ? ORDER BY date DESC LIMIT 1",
      ),
      strain: pick(
        "SELECT date FROM cycles WHERE user_id = ? ORDER BY date DESC LIMIT 1",
      ),
    };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Cycles reconcile (issue #415)
//
// ROOT CAUSE: routine sync coverage gaps longer than `DEFAULT_DAYS`.
//
// A Whoop cycle for date D is not `SCORED` until the cycle closes (next sleep
// onset) and the score lands. If the only routine sync whose window covered D
// ran while D's cycle was still unscored, `persistAll` skips it — and once D
// falls out of the rolling `DEFAULT_DAYS` window, nothing routine ever
// revisits it. recovery/sleep/workouts for D still land, because those DO have
// webhook backstops (`recovery.updated` / `sleep.updated` / `workout.updated`,
// handled in `webhook-handler.ts`), so the day ends up with a recovery row and
// no cycle row.
//
// Whoop does not emit cycle webhooks at all, so there is no webhook backstop
// to add: `webhook_events` across the app's entire history contains only
// recovery.updated (138), sleep.updated (136), workout.updated (126) and
// workout.deleted (2) — zero cycle events, ever. (This also contradicts #263's
// claim that Whoop fires sleep + workout + recovery + cycle back-to-back;
// #263 is wrong on that point.) Polling is therefore the only available fix.
//
// Direct confirmation of the coverage-gap mechanism, measured against prod:
// the 7 consecutive orphaned dates 2026-07-12..07-18 line up exactly with a
// 15-day gap in routine (manual/cron/coach) syncs — 2026-07-11 to 2026-07-26,
// both logged in `sync_logs`, the latter's 7-day window reaching back only to
// 07-19. `fetched_counts.cycles` never diverges from `rows_inserted.cycles` in
// any logged routine sync, so this is not a score_state filter dropping
// fetched records inside a covered window; the window never reached the date.
//
// FIX: on every sync, one indexed local SELECT for recovery rows with no
// matching cycle row, inside a bounded look-back band. If none, return without
// touching the Whoop API. If some are found, fetch `/v2/cycle` over the
// orphaned range (chunked, never one call per date) and upsert whichever come
// back SCORED. Anything still unscored (or simply absent — no cycle ever
// existed for that date) is left for a future sync; there is no retry-count
// state, so this cannot loop, it just no-ops again if nothing changed
// upstream.
//
// The band is bounded on BOTH ends. The upper bound matters as much as the
// lower one: `runWhoopSync` order is fetch → persistAll → reconcile, so any
// date inside the just-fetched window that had scored was already written
// milliseconds earlier and cannot still be an orphan. Every remaining
// in-window "orphan" is by construction a date Whoop just reported as
// unscored in this same sync, and re-fetching it asks the identical question
// and gets the identical answer. Excluding the fetched window therefore
// removes a provably wasted API call, and with it the nightly false positive
// where yesterday's cycle has not scored yet (recovery lands at wake, the
// cycle scores after the next sleep onset) — which otherwise leaves
// `still_missing` chronically non-zero and useless as an operator signal.
// ---------------------------------------------------------------------------

export type ReconcileCyclesResult = {
  lookback_days: number;
  orphans_found: number;
  healed: number;
  /** Orphan dates that came back not-SCORED (or missing entirely) from the
   *  reconcile fetch — left for a future sync to retry. */
  still_missing: number;
  /** Upstream page fetches issued (summed across chunks), not chunk count. */
  api_calls: number;
};

const DEFAULT_RECONCILE_LOOKBACK_DAYS = 30;

/**
 * Max span of a single `/v2/cycle` reconcile fetch. Whoop caps a query's
 * start→end range at roughly 180 days (see #415); 90 keeps a comfortable
 * margin and bounds any one chunk to ~90 records ≈ 4 pages at the client's
 * `PAGE_LIMIT = 25`. Only relevant to the one-time historical backfill — the
 * routine band is always a single chunk.
 */
const RECONCILE_CHUNK_DAYS = 90;

/**
 * `app_settings` marker for the one-time historical backfill, keyed per user
 * (the table is a flat key/value store with no user_id column). Bump the `v1`
 * suffix to force a re-run.
 */
function cyclesBackfillSettingKey(userId: number): string {
  return `cycles_backfill_v1:user:${userId}`;
}

function defaultCyclesReconcileLookbackDays(): number {
  const raw = process.env.CYCLES_RECONCILE_LOOKBACK_DAYS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0
    ? Math.floor(n)
    : DEFAULT_RECONCILE_LOOKBACK_DAYS;
}

/** Pure calendar-date arithmetic on a "YYYY-MM-DD" string — UTC-anchored so
 * it's independent of the caller's tz (the string itself is already the
 * user's local date; we're just walking it forward/back by whole days). */
function shiftDateStr(dateStr: string, deltaDays: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Lower sentinel for the unbounded (historical backfill) orphan scan. */
const DATE_MIN = "0001-01-01";

/**
 * Recovery dates in the inclusive local-date range `[from, to]` for `userId`
 * that have no matching `cycles` row, ascending.
 *
 * Read-only (`forUser` opens the DB read-only — no migration, no write lock);
 * this single indexed SELECT is a clean sync's entire reconcile cost.
 */
function findOrphanedCycleDates(
  userId: number,
  from: string,
  to: string,
): string[] {
  if (from > to) return [];
  return forUser(userId)
    .all<{ date: string }>(
      `SELECT r.date AS date
         FROM recovery r
        WHERE r.date >= ?
          AND r.date <= ?
          AND NOT EXISTS (
            SELECT 1 FROM cycles c
             WHERE c.date = r.date AND c.user_id = r.user_id
          )
          AND r.user_id = ?
        ORDER BY r.date`,
      from,
      to,
    )
    .map((r) => r.date);
}

/**
 * Group ascending orphan dates into fetch chunks each spanning at most
 * `RECONCILE_CHUNK_DAYS`. Orphans cluster (a coverage gap orphans consecutive
 * days), so this issues far fewer calls than a fixed sweep of the whole range
 * would: only spans that actually contain an orphan are fetched at all.
 */
function chunkOrphanDates(dates: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const date of dates) {
    if (current.length === 0) {
      current = [date];
      continue;
    }
    const spanDays =
      (Date.parse(`${date}T00:00:00.000Z`) -
        Date.parse(`${current[0]}T00:00:00.000Z`)) /
      86_400_000;
    if (spanDays > RECONCILE_CHUNK_DAYS) {
      chunks.push(current);
      current = [date];
    } else {
      current.push(date);
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Fetch + heal a set of orphaned dates. One `/v2/cycle` query per chunk (each
 * padded a day on either side so a cycle whose UTC `start` sits just outside
 * the local-date boundary isn't clipped), then one transactional write per
 * chunk covering both the `cycles` upserts and their `daily_summary`
 * recomputes.
 */
async function healOrphanedCycleDates(
  userId: number,
  tz: string,
  orphanDates: string[],
  signal: AbortSignal | undefined,
): Promise<{ healed: number; still_missing: number; api_calls: number }> {
  const pending = new Set(orphanDates);
  let healed = 0;
  let apiCalls = 0;

  for (const chunk of chunkOrphanDates(orphanDates)) {
    checkAborted(signal);
    const start = `${shiftDateStr(chunk[0], -1)}T00:00:00.000Z`;
    const end = `${shiftDateStr(chunk[chunk.length - 1], 1)}T00:00:00.000Z`;

    const { records, pageCount } = await whoopGetAll<WhoopCycleRecord>(
      "/v2/cycle",
      { start, end },
      { userId, signal },
    );
    apiCalls += pageCount;

    // Only records whose local date is one we're actually missing. Duplicates
    // for the same date are handled last-write-wins inside the batch upsert,
    // matching `persistAll`.
    const wanted = records.filter(
      (r) =>
        r.score_state === "SCORED" &&
        r.score &&
        pending.has(cycleSummaryDate(r, tz)),
    );
    for (const date of upsertCyclesAndRecompute(wanted, userId, tz)) {
      if (pending.delete(date)) healed += 1;
    }
  }

  return { healed, still_missing: pending.size, api_calls: apiCalls };
}

/**
 * Bounded look-back reconcile for the orphaned-cycle gap. Cheap when there's
 * nothing to do (one SELECT, zero Whoop calls).
 *
 * `skipRecentDays` trims the recent end of the band: dates newer than
 * `today - skipRecentDays` are excluded. `runWhoopSync` passes its own fetch
 * window here, because a date it just fetched either scored (and `persistAll`
 * already wrote it) or did not (and re-asking cannot change the answer). The
 * default of 1 excludes only today, for standalone/manual invocations.
 */
export async function reconcileCycles(
  userId: number,
  tz: string,
  opts: {
    signal?: AbortSignal;
    lookbackDays?: number;
    skipRecentDays?: number;
  } = {},
): Promise<ReconcileCyclesResult> {
  const lookbackDays = opts.lookbackDays ?? defaultCyclesReconcileLookbackDays();
  const skipRecentDays = Math.max(1, opts.skipRecentDays ?? 1);
  const result: ReconcileCyclesResult = {
    lookback_days: lookbackDays,
    orphans_found: 0,
    healed: 0,
    still_missing: 0,
    api_calls: 0,
  };

  const today = parseDate(new Date().toISOString(), tz);
  const orphanDates = findOrphanedCycleDates(
    userId,
    shiftDateStr(today, -lookbackDays),
    shiftDateStr(today, -skipRecentDays),
  );
  result.orphans_found = orphanDates.length;
  if (orphanDates.length === 0) return result;

  checkAborted(opts.signal);
  Object.assign(
    result,
    await healOrphanedCycleDates(userId, tz, orphanDates, opts.signal),
  );
  return result;
}

/**
 * One-time historical backfill of orphaned cycles over the FULL recovery date
 * range (issue #415's acceptance criterion: "no date has a recovery row
 * without its corresponding cycle row, for non-current days"). The routine
 * `reconcileCycles` band only reaches back `lookbackDays`, so dates orphaned
 * before this shipped would otherwise stay orphaned forever — and the
 * alternative remedy (an operator temporarily widening
 * `CYCLES_RECONCILE_LOOKBACK_DAYS`) means editing a root-owned mode-600
 * systemd override, restarting, syncing, reverting and restarting again.
 *
 * Guarded by a per-user `app_settings` marker so it runs exactly once. Returns
 * null when the marker is already present (the steady state: one indexed
 * `app_settings` lookup and nothing else).
 *
 * The marker is written only after the pass completes, so a failed attempt
 * (upstream 5xx, abort) retries on the next sync rather than silently skipping
 * the heal. `still_missing > 0` still counts as complete — dates Whoop has no
 * scored cycle for are not going to become scored by re-asking every sync.
 *
 * Cost on first run is bounded by `chunkOrphanDates`: only spans that actually
 * contain an orphan are fetched, at most `RECONCILE_CHUNK_DAYS` wide. For the
 * 12 known prod orphans (2026-06-04 .. 2026-07-26, one 52-day span) that is a
 * single chunk of a few pages, not a sweep of the ~250-day recovery history.
 */
export async function backfillOrphanedCyclesOnce(
  userId: number,
  tz: string,
  opts: { signal?: AbortSignal; skipRecentDays?: number } = {},
): Promise<ReconcileCyclesResult | null> {
  const key = cyclesBackfillSettingKey(userId);
  if (getSetting(key) !== null) return null;

  const skipRecentDays = Math.max(1, opts.skipRecentDays ?? 1);
  const today = parseDate(new Date().toISOString(), tz);
  const orphanDates = findOrphanedCycleDates(
    userId,
    DATE_MIN,
    shiftDateStr(today, -skipRecentDays),
  );

  const result: ReconcileCyclesResult = {
    lookback_days: 0, // unbounded — the whole recovery history
    orphans_found: orphanDates.length,
    healed: 0,
    still_missing: 0,
    api_calls: 0,
  };
  if (orphanDates.length > 0) {
    checkAborted(opts.signal);
    Object.assign(
      result,
      await healOrphanedCycleDates(userId, tz, orphanDates, opts.signal),
    );
  }

  setSetting(
    key,
    JSON.stringify({ completed_at: new Date().toISOString(), ...result }),
  );
  log.info({ user_id: userId, ...result }, "cycles historical backfill complete");
  return result;
}

// ---------------------------------------------------------------------------
// Sleep wake-day re-date backfill (issue #440)
//
// ROOT CAUSE: `sleepSummaryDate` used to key a sleep row on the local day it
// STARTED. A sleep beginning 23:11 and ending 08:38 the next morning was
// filed under the day it began — colliding with the early-morning sleep
// already on that day, while the day it actually belongs to got no sleep
// row at all. `recoverySummaryDate` keys on `created_at` (recovery is
// created when the sleep ENDS), so the two halves of one night ended up
// filed under different dates. `sleepSummaryDate` now keys on `r.end`
// instead, realigning the two. This backfill re-dates EXISTING rows to
// match.
//
// Unlike the cycles backfill, this needs no Whoop API call: every `sleep`
// row already carries its own `raw` JSON (100% populated, including all 141
// legacy rows with NULL `start_local`/`end_local` — verified against prod),
// so the corrected date is derived locally from `raw.end`.
// ---------------------------------------------------------------------------

export type SleepWakeDayBackfillResult = {
  rows_scanned: number;
  rows_changed: number;
  /** Rows whose `raw` was missing, unparseable, or lacked `.end` — left
   *  untouched rather than treated as fatal. */
  rows_skipped: number;
  /** Distinct dates whose `daily_summary` was recomputed — both the date a
   *  changed row LEFT and the date it moved TO, since a row leaving date D
   *  means D's `daily_summary` is stale too, not just the destination. The
   *  re-date UPDATEs and every recompute here share one transaction (see
   *  the function's doc comment), so this result object is only ever
   *  returned after a clean commit — there is no "some recomputes failed"
   *  partial state to report. */
  dates_recomputed: number;
  /** Dates where re-dating left MORE THAN ONE non-nap sleep sharing that
   *  date. Not data loss — the PK is `(user_id, sleep_id)` and nothing is
   *  deleted — but every deduped read (charts, `daily_summary`, the Coach)
   *  picks exactly one winner per date, so the loser becomes invisible with
   *  no other signal. Prod pre-measurement said 0, but a one-shot
   *  irreversible migration of a dataset with no other copy must not just
   *  trust that number blind — this is the actual post-migration count. */
  collisions: number;
};

/**
 * `app_settings` marker for the one-time sleep wake-day re-date backfill,
 * keyed per user (precedent: `cyclesBackfillSettingKey`). Bump the `v1`
 * suffix to force a re-run.
 */
function sleepWakeDayBackfillSettingKey(userId: number): string {
  return `sleep_wake_day_v1:user:${userId}`;
}

/**
 * One-time per-user re-date of existing `sleep` rows from start-day to
 * wake-day attribution. Guarded by an `app_settings` marker so it runs
 * exactly once; returns null when the marker is already present.
 *
 * MUST run before `persistAll` writes this sync's fetched window (see the
 * call site in `runWhoopSync`): `persistAll` already computes each sleep's
 * `date` via the fixed `sleepSummaryDate` (keyed on `r.end`), so if it runs
 * first it silently pre-corrects any pre-existing wrong-dated row inside the
 * fetch window via `INSERT OR REPLACE` — by the time this function scans the
 * table, `raw.end` and `date` already agree, so the row is never flagged as
 * "changed" and the date it VACATED never gets recomputed. Scanning before
 * `persistAll` runs lets this function see genuine pre-migration state.
 *
 * The marker is written even when zero rows change (a user with no
 * midnight-spanning sleeps) — the point is "ran once", not "changed
 * something". It's also written when the DB has zero sleep rows at all, so
 * a fresh install doesn't re-scan an empty table on every sync.
 *
 * Rows whose `raw` is missing, unparseable, or lacks `.end` are skipped
 * (counted, not thrown) rather than failing the whole pass — a handful of
 * bad rows shouldn't block every other row's correction, and there is no
 * retry-count state, so a genuinely bad row would just be skipped forever,
 * which is the correct outcome (there's nothing to re-derive it from).
 *
 * Fails CLOSED if the DB can't even be opened: this is a one-shot,
 * effectively irreversible migration (the marker disables all future runs),
 * so a transient DB-unavailable blip must not be allowed to write the
 * marker having scanned zero rows — that would look identical to the
 * legitimate "fresh install, no sleep rows yet" case forever after. Throws
 * instead; the caller in `runWhoopSync` already treats this like the other
 * best-effort post-persist steps (catches it into `sleep_backfill_error`
 * without failing the sync) and will retry on the next one.
 *
 * The re-date UPDATEs and the `daily_summary` recomputes for every touched
 * date run inside ONE transaction on ONE connection — nothing commits
 * unless everything commits. This is load-bearing for retry safety, not
 * just atomicity theater: once a row's `date` UPDATE commits on its own,
 * `raw.end` and `date` agree for that row, so a later re-run of this
 * function (because the marker was withheld) would compute
 * `newDate === row.date`, never re-flag the row as "changed", and never
 * rediscover the date it vacated — the idempotent re-date is exactly what
 * makes a split-transaction retry blind. An earlier version of this
 * function ran the UPDATEs in their own transaction and the recomputes
 * afterward via separate `recomputeDailySummary()` calls; a recompute
 * failure there left the re-date committed, the recompute silently
 * unattempted-forever, and (worse) the marker still got written on the
 * NEXT call because the now-idempotent scan found nothing left to do
 * (issue #440 review, second pass). Folding both into one transaction means
 * a mid-recompute failure now rolls back the UPDATEs too, so the next call
 * sees the original pre-migration state and gets a genuine second attempt.
 */
export function backfillSleepWakeDayOnce(
  userId: number,
  tz: string,
): SleepWakeDayBackfillResult | null {
  const key = sleepWakeDayBackfillSettingKey(userId);
  if (getSetting(key) !== null) return null;

  const db = openWrite();
  if (!db) {
    throw new Error(
      "[backfillSleepWakeDayOnce] DB unavailable (no whoop_data.db at expected path)",
    );
  }

  const result: SleepWakeDayBackfillResult = {
    rows_scanned: 0,
    rows_changed: 0,
    rows_skipped: 0,
    dates_recomputed: 0,
    collisions: 0,
  };

  try {
    const rows = db
      .prepare("SELECT sleep_id, date, raw, nap FROM sleep WHERE user_id = ?")
      .all(userId) as {
      sleep_id: string;
      date: string;
      raw: string | null;
      nap: number | null;
    }[];
    result.rows_scanned = rows.length;

    // Final (post-backfill) date per sleep_id — needed for the collision
    // check below, independent of whether this particular row's date
    // changed.
    const finalDateBySleepId = new Map<string, string>();
    const changes: { sleep_id: string; new_date: string; old_date: string }[] = [];
    for (const row of rows) {
      let end: unknown;
      try {
        end = row.raw ? (JSON.parse(row.raw) as { end?: unknown }).end : undefined;
      } catch {
        end = undefined;
      }
      if (typeof end !== "string" || end.length === 0) {
        result.rows_skipped += 1;
        finalDateBySleepId.set(row.sleep_id, row.date);
        continue;
      }
      let newDate: string;
      try {
        newDate = parseDate(end, tz);
      } catch {
        result.rows_skipped += 1;
        finalDateBySleepId.set(row.sleep_id, row.date);
        continue;
      }
      finalDateBySleepId.set(row.sleep_id, newDate);
      if (newDate !== row.date) {
        changes.push({ sleep_id: row.sleep_id, new_date: newDate, old_date: row.date });
      }
    }

    const touchedDates = new Set<string>();
    for (const c of changes) {
      touchedDates.add(c.old_date);
      touchedDates.add(c.new_date);
    }

    const update = db.prepare(
      "UPDATE sleep SET date = ? WHERE user_id = ? AND sleep_id = ?",
    );
    const summarySelect = db.prepare(SUMMARY_SELECT_SQL);
    const summaryInsert = db.prepare(SUMMARY_INSERT_SQL);

    // Single transaction: every re-date UPDATE and every touched date's
    // daily_summary recompute, or none of them. See the doc comment above
    // for why splitting these across transactions/connections makes a
    // partial failure unrecoverable rather than merely incomplete.
    db.transaction(() => {
      for (const c of changes) {
        update.run(c.new_date, userId, c.sleep_id);
      }
      for (const date of touchedDates) {
        const row = summarySelect.get(
          date,
          date,
          userId,
          userId,
          userId,
          userId,
        ) as Record<string, unknown> | undefined;
        if (row) summaryInsert.run({ ...row, user_id: userId });
      }
    })();
    result.rows_changed = changes.length;
    result.dates_recomputed = touchedDates.size;

    // Collision check: dates where re-dating leaves >1 non-nap sleep.
    // Naps are excluded — the read-side dedup selector only applies to
    // COALESCE(nap,0)=0 rows, so two naps (or a nap plus a night) sharing a
    // date isn't a collision in that sense.
    const nonNapDateCounts = new Map<string, number>();
    for (const row of rows) {
      if (row.nap) continue;
      const finalDate = finalDateBySleepId.get(row.sleep_id)!;
      nonNapDateCounts.set(finalDate, (nonNapDateCounts.get(finalDate) ?? 0) + 1);
    }
    for (const count of nonNapDateCounts.values()) {
      if (count > 1) result.collisions += 1;
    }
    if (result.collisions > 0) {
      log.warn(
        { user_id: userId, collisions: result.collisions },
        "sleep wake-day backfill: dates with >1 non-nap sleep after re-date",
      );
    }
  } finally {
    db.close();
  }

  // Only reached if the transaction above committed cleanly — a throw from
  // inside it (e.g. SQLITE_BUSY on a recompute) propagates past this point
  // uncaught, so the marker is never written. `runWhoopSync` catches it
  // into `details.sleep_backfill_error` without failing the sync, and the
  // next sync gets a clean retry against the still-unmigrated rows.
  setSetting(
    key,
    JSON.stringify({ completed_at: new Date().toISOString(), ...result }),
  );
  log.info(
    { user_id: userId, ...result },
    "sleep wake-day backfill complete",
  );
  return result;
}

export async function runWhoopSync(
  opts: {
    /** Owner of the Whoop integration to sync. Required — no fallback. */
    userId: number;
    days?: number;
    signal?: AbortSignal;
    onProgress?: (e: SyncProgressEvent) => void;
  },
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
    sleep_missing_end_skipped: 0,
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

  let post: { counts: SyncCounts; fetched: SyncCounts } | null = null;

  try {
    checkAborted(opts.signal);

    // Pre-warm the access token so `refreshing_token` is the first stage
    // event deterministically — before the parallel fetch burst. Seeds
    // `inflightRefreshByUser` so the parallel `whoopGet` calls below either
    // skip refresh or join the same in-flight promise (single emit). No-op
    // if token is fresh; returns null on auth failure (downstream
    // `whoopGet` will surface `WhoopAuthError`). May still throw on
    // transport failure (DNS / TLS / `AbortSignal.timeout`) — caught by
    // the outer try and routed to the pre-commit failure branch.
    await getValidAccessToken(opts.userId, false, {
      onRefresh: () => opts.onProgress?.({ stage: "refreshing_token" }),
    });

    // Phase D — lazy backfill of `integrations.provider_user_id` so
    // webhook events for this user route to the right local tenant. The
    // OAuth callback is the primary capture path; this is the resilience
    // layer for rows that pre-date Phase D or whose callback fetch failed.
    // Failure here is non-fatal — sync continues against the tokens we
    // already have.
    try {
      const integration = getIntegration(opts.userId, "whoop");
      if (integration && integration.provider_user_id == null) {
        const profile = await getWhoopProfile({ userId: opts.userId });
        if (profile?.user_id != null) {
          setProviderUserId(opts.userId, "whoop", String(profile.user_id));
        }
      }
    } catch (err) {
      log.warn(
        {
          user_id: opts.userId,
          err: err instanceof Error ? err.message : String(err),
        },
        "provider_user_id backfill failed",
      );
    }

    const fetchT0 = Date.now();
    const { data, fetchBreakdown, pageCounts } = await fetchAllParallel(
      opts.userId,
      start,
      end,
      opts.signal,
      opts.onProgress,
    );
    details.fetch_ms = Date.now() - fetchT0;
    details.fetch_breakdown = fetchBreakdown;
    details.page_counts = pageCounts;

    checkAborted(opts.signal);

    const userSettings = getUserSettings(opts.userId);
    const tz = userSettings?.tz ?? "UTC";

    // Sleep wake-day re-date backfill (issue #440) — best-effort: a failure
    // here must not fail an otherwise-successful sync. Unlike the cycles
    // backfill this makes no Whoop API call (pure local re-date from
    // already-synced `raw` JSON), so it's cheap even the one time it does
    // real work.
    //
    // MUST run BEFORE `persistAll` below. `persistAll` computes each
    // sleep's `date` via the fixed `sleepSummaryDate` (keyed on `r.end`), so
    // if it ran first it would silently pre-correct any pre-existing
    // wrong-dated row inside this sync's fetch window via `INSERT OR
    // REPLACE` — by the time the backfill scanned the table, the row would
    // already show the right date and never register as "changed", so the
    // date it vacated would never get recomputed. Running first lets the
    // backfill see genuine pre-migration state. See the function's doc
    // comment for the full rationale (issue #440 review, BLOCK 5).
    try {
      const sleepBackfill = backfillSleepWakeDayOnce(opts.userId, tz);
      if (sleepBackfill) details.sleep_backfill = sleepBackfill;
    } catch (err) {
      details.sleep_backfill_error =
        err instanceof Error ? err.message : String(err);
    }

    opts.onProgress?.({ stage: "upserting" });
    const dbT0 = Date.now();
    const { counts, sleepMissingEndSkipped } = persistAll(
      data,
      opts.userId,
      opts.signal,
      tz,
    );
    details.sync_db_ms = Date.now() - dbT0;
    details.sleep_missing_end_skipped = sleepMissingEndSkipped;
    post = {
      counts,
      fetched: {
        recovery: data.recovery.length,
        sleep: data.sleep.length,
        cycles: data.cycles.length,
        workouts: data.workouts.length,
      },
    };

    // Surface a post-commit abort BEFORE entering the body-upsert try/catch,
    // so it doesn't get mislabeled as `body_error`.
    checkAborted(opts.signal);

    // Body measurement is deduped against the latest stored row, so it's safe
    // to run after the main transaction. Failures here surface in details
    // (sync_logs) but don't fail the sync — recovery / sleep / cycles /
    // workouts are already committed.
    const bodyT0 = Date.now();
    try {
      upsertBodyMeasurement(data.body, opts.userId);
    } catch (err) {
      details.body_error =
        err instanceof Error ? err.message : String(err);
    }
    details.body_ms = Date.now() - bodyT0;
    details.summary_dates = syncedDates(data, tz).length;

    // Cycles reconcile (issue #415) — best-effort, like the body upsert
    // above: a failure here must not fail an otherwise-successful sync.
    // Cheap when clean (one SELECT, no API call); see `reconcileCycles` doc
    // comment for the full rationale. Placed before the checkAborted below
    // so a mid-reconcile abort still surfaces through the existing
    // post-commit-abort → `partial: true` path rather than being swallowed
    // here.
    //
    // `skipRecentDays: days` excludes the window this sync just fetched.
    // `persistAll` above already wrote every cycle in it that had scored, so a
    // remaining in-window orphan is a date Whoop reported as unscored moments
    // ago in this same request — re-fetching it is a deterministic no-op.
    //
    // The one-time historical backfill runs first and, on the single sync
    // where it fires, covers a strict superset of the routine band, so the
    // routine pass is skipped that once rather than re-fetching the same
    // dates.
    const reconcileT0 = Date.now();
    try {
      const backfill = await backfillOrphanedCyclesOnce(opts.userId, tz, {
        signal: opts.signal,
        skipRecentDays: days,
      });
      if (backfill) {
        details.cycles_backfill = backfill;
      } else {
        details.reconcile = await reconcileCycles(opts.userId, tz, {
          signal: opts.signal,
          skipRecentDays: days,
        });
      }
    } catch (err) {
      details.reconcile_error =
        err instanceof Error ? err.message : String(err);
    }
    details.reconcile_ms = Date.now() - reconcileT0;

    checkAborted(opts.signal);

    const latest = latestDates(opts.userId);
    // Success-path only — placement after the final `checkAborted` is
    // load-bearing; the partial branch must not emit this.
    opts.onProgress?.({ stage: "computing_summary" });
    return {
      success: true,
      latest_recovery_date: latest.recovery,
      latest_sleep_date: latest.sleep,
      latest_strain_date: latest.strain,
      rows_inserted: counts,
      fetched_counts: post.fetched,
      details,
    };
  } catch (err) {
    // DOMException (e.g. AbortError) extends Error in Node 20+, so the
    // single Error-name check covers both branches.
    const isAbort = err instanceof Error && err.name === "AbortError";

    // Anything that throws AFTER the transaction committed — abort signal
    // OR a post-commit exception (latestDates SQLITE_BUSY, etc.) — must
    // still report success. Rows ARE in the DB; returning `success: false`
    // misleads callers (Coach surfaces "sync failed" — see issue #242).
    // latestDates() is a separate read open and abort signals don't cancel
    // it, so attempt the metadata read here too; fall back to null on its
    // own throw.
    if (post) {
      let latestPost: LatestDates;
      try {
        latestPost = latestDates(opts.userId);
      } catch {
        latestPost = { recovery: null, sleep: null, strain: null };
      }
      const result: SyncResult = {
        success: true,
        latest_recovery_date: latestPost.recovery,
        latest_sleep_date: latestPost.sleep,
        latest_strain_date: latestPost.strain,
        rows_inserted: post.counts,
        fetched_counts: post.fetched,
        details,
        partial: true,
      };
      if (!isAbort) {
        result.error =
          err instanceof Error ? err.message : String(err);
      }
      return result;
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
    const latest = latestDates(opts.userId);
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
