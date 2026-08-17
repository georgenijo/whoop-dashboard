import "server-only";
import { open, openWrite } from "@/lib/db/connection";
import { getUserSettings } from "@/lib/db";
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
  recomputeDailySummary,
  recoverySummaryDate,
  sleepSummaryDate,
  toLocalIso,
  upsertBodyMeasurement,
  upsertCycle,
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
    body_error?: string;
    /** Cycles reconcile (issue #415) outcome — absent if it threw before
     *  producing a result (see `reconcile_error`). */
    reconcile?: ReconcileCyclesResult;
    reconcile_ms?: number;
    reconcile_error?: string;
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
LEFT JOIN sleep ON sleep.date = day.date AND COALESCE(sleep.nap, 0) = 0 AND sleep.user_id = ?
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
    if (r.score_state === "SCORED") dates.add(sleepSummaryDate(r, tz));
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
 */
function persistAll(
  data: FetchedData,
  userId: number,
  signal: AbortSignal | undefined,
  tz: string,
): SyncCounts {
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
        const ss = r.score.stage_summary;
        const sn = r.score.sleep_needed;
        sleepStmt.run({
          user_id: userId,
          sleep_id: r.id,
          date: parseDate(r.start, tz),
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
// recovery/sleep/workouts each get a second chance to land after the routine
// `DEFAULT_DAYS`-window sync moves past their date: Whoop delivers
// recovery.updated / sleep.updated / workout.updated webhooks whenever the
// upstream record (re)scores, and `webhook-handler.ts` upserts on receipt.
// Cycles get NO such webhook — Whoop never sends `cycle.updated`, and
// `handleEvent` has no case for it. So a cycle that was still `score_state !==
// "SCORED"` at the one moment its date sat inside a routine sync's window is
// orphaned forever once that window moves on: recovery for the day lands
// (via its own webhook or a later routine sync), cycles never do.
//
// Confirmed against prod (2026-08-16, user 2): the 7 consecutive orphaned
// dates 2026-07-12..07-18 line up exactly with a 15-day gap in routine
// (manual/cron/coach) syncs — 2026-07-11 to 2026-07-26, both logged in
// `sync_logs` — while `recovery.updated`/`sleep.updated` webhooks kept firing
// throughout that gap (`sync_logs` has zero `cycle.*` event rows, ever).
// `fetched_counts.cycles` never diverges from `rows_inserted.cycles` in any
// logged routine sync, so this is a coverage gap (window never reached the
// date), not a score_state filter dropping fetched-but-unscored records
// within a covered window.
//
// Fix: on every sync, check locally (one indexed SELECT) for recovery rows
// with no matching cycle row inside a bounded look-back window. If none,
// return without touching the Whoop API — a clean sync pays one extra SELECT
// and nothing else. If some are found, issue ONE bounded `/v2/cycle` fetch
// spanning the orphaned dates (not one call per date) and upsert whichever
// come back SCORED. Anything still unscored (or just absent from the
// response — e.g. no cycle ever existed for that date) is left for the next
// sync to retry; there is no retry-count state, so this can't loop forever,
// it just no-ops again next time if nothing has changed upstream.
// ---------------------------------------------------------------------------

export type ReconcileCyclesResult = {
  lookback_days: number;
  orphans_found: number;
  healed: number;
  /** Orphan dates that came back not-SCORED (or missing entirely) from the
   *  reconcile fetch — left for a future sync to retry. */
  still_missing: number;
  api_calls: number;
};

function defaultCyclesReconcileLookbackDays(): number {
  const raw = process.env.CYCLES_RECONCILE_LOOKBACK_DAYS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 21;
}

/** Pure calendar-date arithmetic on a "YYYY-MM-DD" string — UTC-anchored so
 * it's independent of the caller's tz (the string itself is already the
 * user's local date; we're just walking it forward/back by whole days). */
function shiftDateStr(dateStr: string, deltaDays: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Recovery dates in `[today - lookbackDays, today)` for `userId` that have
 * no matching `cycles` row. Excludes today — the current cycle is normally
 * still open/unscored, and the acceptance criterion is about non-current
 * days. Read-only open (no migration, no write lock) — a clean sync's entire
 * reconcile cost.
 */
function findOrphanedCycleDates(
  userId: number,
  tz: string,
  lookbackDays: number,
): string[] {
  const db = open();
  if (!db) return [];
  try {
    const today = parseDate(new Date().toISOString(), tz);
    const start = shiftDateStr(today, -lookbackDays);
    const rows = db
      .prepare(
        `SELECT r.date AS date
         FROM recovery r
         WHERE r.user_id = ?
           AND r.date >= ?
           AND r.date < ?
           AND NOT EXISTS (
             SELECT 1 FROM cycles c
             WHERE c.user_id = r.user_id AND c.date = r.date
           )
         ORDER BY r.date`,
      )
      .all(userId, start, today) as { date: string }[];
    return rows.map((r) => r.date);
  } finally {
    db.close();
  }
}

/**
 * Bounded look-back reconcile for the orphaned-cycle gap. Cheap when there's
 * nothing to do (one SELECT, zero Whoop calls); when orphans exist, issues a
 * single `/v2/cycle` fetch spanning their date range and upserts whichever
 * records come back SCORED and match one of the orphaned dates.
 */
export async function reconcileCycles(
  userId: number,
  tz: string,
  opts: { signal?: AbortSignal; lookbackDays?: number } = {},
): Promise<ReconcileCyclesResult> {
  const lookbackDays = opts.lookbackDays ?? defaultCyclesReconcileLookbackDays();
  const result: ReconcileCyclesResult = {
    lookback_days: lookbackDays,
    orphans_found: 0,
    healed: 0,
    still_missing: 0,
    api_calls: 0,
  };

  const orphanDates = findOrphanedCycleDates(userId, tz, lookbackDays);
  result.orphans_found = orphanDates.length;
  if (orphanDates.length === 0) return result;

  checkAborted(opts.signal);

  // One bounded fetch spanning the full orphan range, padded a day on each
  // side so a cycle whose UTC `start` falls just outside the local-date
  // boundary (tz offset) isn't clipped. Never one call per orphaned date.
  const minDate = orphanDates[0];
  const maxDate = orphanDates[orphanDates.length - 1];
  const start = `${shiftDateStr(minDate, -1)}T00:00:00.000Z`;
  const end = `${shiftDateStr(maxDate, 1)}T00:00:00.000Z`;

  const { records } = await whoopGetAll<WhoopCycleRecord>(
    "/v2/cycle",
    { start, end },
    { userId, signal: opts.signal },
  );
  result.api_calls = 1;

  const orphanSet = new Set(orphanDates);
  const healedDates: string[] = [];
  for (const r of records) {
    if (r.score_state !== "SCORED" || !r.score) continue;
    const date = cycleSummaryDate(r, tz);
    if (!orphanSet.has(date)) continue;
    if (upsertCycle(r, userId, tz)) {
      orphanSet.delete(date);
      healedDates.push(date);
    }
  }
  result.healed = healedDates.length;
  result.still_missing = orphanSet.size;
  for (const date of healedDates) {
    recomputeDailySummary(date, userId);
  }
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

    opts.onProgress?.({ stage: "upserting" });
    const dbT0 = Date.now();
    const userSettings = getUserSettings(opts.userId);
    const tz = userSettings?.tz ?? "UTC";
    const counts = persistAll(data, opts.userId, opts.signal, tz);
    details.sync_db_ms = Date.now() - dbT0;
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
    const reconcileT0 = Date.now();
    try {
      details.reconcile = await reconcileCycles(opts.userId, tz, {
        signal: opts.signal,
      });
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
