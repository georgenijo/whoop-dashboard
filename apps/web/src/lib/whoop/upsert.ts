import "server-only";
import { openWrite, type DB } from "@/lib/db/connection";
import { MATCH_WINDOW_MS, SQL_WINDOW_MS, sportsCompatible } from "@/lib/healthkit/match";

// KEEP IN SYNC WITH streamlit/whoop/db.py:147-262 (column lists for recovery/cycles/sleep/workouts)
// KEEP IN SYNC WITH sync/daily_summary.py:26-91 (SELECT/INSERT_DAILY_SUMMARY SQL)

export type WhoopSleepRecord = {
  id: string;
  start: string;
  end?: string;
  timezone_offset?: string;
  nap?: boolean;
  score_state?: string;
  score?: {
    sleep_performance_percentage?: number | null;
    sleep_efficiency_percentage?: number | null;
    sleep_consistency_percentage?: number | null;
    respiratory_rate?: number | null;
    stage_summary: {
      total_in_bed_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
      total_awake_time_milli: number;
      disturbance_count: number;
      sleep_cycle_count: number;
    };
    sleep_needed: {
      baseline_milli: number;
      need_from_sleep_debt_milli: number;
      need_from_recent_strain_milli: number;
      need_from_recent_nap_milli: number;
    };
  };
};

export type WhoopCycleRecord = {
  id?: number;
  start: string;
  end?: string;
  score_state?: string;
  score?: {
    strain: number;
    kilojoule: number;
    average_heart_rate: number;
    max_heart_rate: number;
  };
};

export type WhoopBodyMeasurement = {
  height_meter?: number | null;
  weight_kilogram?: number | null;
  max_heart_rate?: number | null;
};

export type WhoopRecoveryRecord = {
  cycle_id?: number;
  sleep_id: string;
  score_state?: string;
  created_at: string;
  score?: {
    recovery_score: number;
    hrv_rmssd_milli: number;
    resting_heart_rate: number;
    spo2_percentage?: number | null;
    skin_temp_celsius?: number | null;
  };
};

export type WhoopWorkoutRecord = {
  id: string;
  start: string;
  end: string;
  sport_name?: string;
  score_state?: string;
  score?: {
    average_heart_rate: number;
    max_heart_rate: number;
    strain: number;
    kilojoule: number;
    distance_meter?: number | null;
    zone_durations: {
      zone_zero_milli: number;
      zone_one_milli: number;
      zone_two_milli: number;
      zone_three_milli: number;
      zone_four_milli: number;
      zone_five_milli: number;
    };
  };
};

// File the row under the user's local calendar day per their IANA tz. DST-correct
// via ICU. `tz` is required (no implicit UTC default) — past silent UTC defaults
// produced misfiled rows for evening activity in west-of-UTC zones (issue #345).
// Callers that genuinely have no user tz must pass `"UTC"` explicitly.
export function parseDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

// File a sleep under the calendar day it ENDED (the wake day), not the day it
// started. A sleep beginning 23:11 and ending 08:38 the next morning used to
// be filed on the day it began, colliding with the early-morning sleep
// already on that day — while the day it actually belongs to got no sleep
// row at all. `recoverySummaryDate` keys on `created_at` (recovery is
// created when the sleep ENDS), so wake-day attribution here realigns a
// night's sleep with its own recovery row (issue #440). Falls back to
// `r.start` if `r.end` is missing (the field is optional in the Whoop type,
// though every SCORED record — the only ones callers pass here — has it).
export function sleepSummaryDate(r: WhoopSleepRecord, tz: string): string {
  return parseDate(r.end ?? r.start, tz);
}

export function workoutSummaryDate(r: WhoopWorkoutRecord, tz: string): string {
  return parseDate(r.start, tz);
}

export function recoverySummaryDate(r: WhoopRecoveryRecord, tz: string): string {
  return parseDate(r.created_at, tz);
}

export function cycleSummaryDate(r: WhoopCycleRecord, tz: string): string {
  return parseDate(r.start, tz);
}

// Mirrors streamlit/whoop/db.py:_to_local_iso — convert UTC ISO + "+HH:MM" offset
// to a naive local ISO string (YYYY-MM-DDTHH:MM:SS).
export function toLocalIso(
  utcIso: string | null | undefined,
  tzOffset: string | null | undefined,
): string | null {
  if (!utcIso || !tzOffset) return null;
  try {
    const utcMs = new Date(utcIso).getTime();
    if (Number.isNaN(utcMs)) return null;
    const sign = tzOffset[0] === "+" ? 1 : tzOffset[0] === "-" ? -1 : 0;
    if (sign === 0) return null;
    const [hh, mm] = tzOffset.slice(1).split(":");
    const offsetMin = sign * (parseInt(hh, 10) * 60 + parseInt(mm, 10));
    const localMs = utcMs + offsetMin * 60_000;
    const d = new Date(localMs);
    // Use UTC getters so we read back the shifted value verbatim, with no
    // additional local-zone offset applied.
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
      `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
    );
  } catch {
    return null;
  }
}

export function upsertSleep(record: WhoopSleepRecord, userId: number, tz: string): boolean {
  if (record.score_state !== "SCORED" || !record.score) return false;
  const db = openWrite();
  if (!db) return false;
  try {
    const ss = record.score.stage_summary;
    const sn = record.score.sleep_needed;
    // KEEP IN SYNC WITH streamlit/whoop/db.py:223-275 (sync_sleep column order)
    db.prepare(`
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
    `).run({
      user_id: userId,
      sleep_id: record.id,
      date: sleepSummaryDate(record, tz),
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
      performance: record.score.sleep_performance_percentage ?? null,
      efficiency: record.score.sleep_efficiency_percentage ?? null,
      consistency: record.score.sleep_consistency_percentage ?? null,
      respiratory_rate: record.score.respiratory_rate ?? null,
      disturbances: ss.disturbance_count,
      cycles: ss.sleep_cycle_count,
      nap: record.nap ? 1 : 0,
      need_from_baseline_ms: sn.baseline_milli,
      need_from_debt_ms: sn.need_from_sleep_debt_milli,
      need_from_strain_ms: sn.need_from_recent_strain_milli,
      need_from_nap_ms: sn.need_from_recent_nap_milli,
      start_local: toLocalIso(record.start, record.timezone_offset),
      end_local: toLocalIso(record.end, record.timezone_offset),
      raw: JSON.stringify(record),
    });
    return true;
  } finally {
    db.close();
  }
}

// KEEP IN SYNC WITH streamlit/whoop/db.py:187-206 (sync_cycles column order)
const CYCLE_UPSERT_SQL = `
  INSERT OR REPLACE INTO cycles
    (user_id, date, strain, kilojoule, avg_hr, max_hr, raw)
  VALUES
    (@user_id, @date, @strain, @kilojoule, @avg_hr, @max_hr, @raw)
`;

export function upsertCycle(record: WhoopCycleRecord, userId: number, tz: string): boolean {
  if (record.score_state !== "SCORED" || !record.score) return false;
  const db = openWrite();
  if (!db) return false;
  try {
    db.prepare(CYCLE_UPSERT_SQL).run({
      user_id: userId,
      date: parseDate(record.start, tz),
      strain: record.score.strain,
      kilojoule: record.score.kilojoule,
      avg_hr: record.score.average_heart_rate,
      max_hr: record.score.max_heart_rate,
      raw: JSON.stringify(record),
    });
    return true;
  } finally {
    db.close();
  }
}

/**
 * Upsert a batch of cycle records AND recompute `daily_summary` for every
 * date they touch — one connection, one transaction.
 *
 * Exists because looping `upsertCycle` + `recomputeDailySummary` per record
 * opens two write connections per healed date (each paying the lazy-ALTER
 * migration check called out in issue #505) and, worse, is not atomic: a
 * throw partway through leaves `cycles.strain` written for some dates while
 * `daily_summary.day_strain` stays NULL for them, so /overview and /strain
 * disagree with the cycles table until something else touches the day.
 * `persistAll` in `sync.ts` already uses the single-transaction shape; the
 * cycles reconcile (#415) uses this to match it.
 *
 * Records that aren't `SCORED` are skipped. Duplicate records for the same
 * date are LAST-write-wins, matching `persistAll`'s `INSERT OR REPLACE` loop.
 *
 * Returns the distinct dates written, in first-seen order.
 */
export function upsertCyclesAndRecompute(
  records: WhoopCycleRecord[],
  userId: number,
  tz: string,
): string[] {
  const db = openWrite();
  if (!db) return [];
  try {
    const stmt = db.prepare(CYCLE_UPSERT_SQL);
    return db.transaction(() => {
      const dates: string[] = [];
      const seen = new Set<string>();
      for (const record of records) {
        if (record.score_state !== "SCORED" || !record.score) continue;
        const date = parseDate(record.start, tz);
        stmt.run({
          user_id: userId,
          date,
          strain: record.score.strain,
          kilojoule: record.score.kilojoule,
          avg_hr: record.score.average_heart_rate,
          max_hr: record.score.max_heart_rate,
          raw: JSON.stringify(record),
        });
        if (!seen.has(date)) {
          seen.add(date);
          dates.push(date);
        }
      }
      for (const date of dates) _recomputeInDb(db, date, userId);
      return dates;
    })();
  } finally {
    db.close();
  }
}

// KEEP IN SYNC WITH streamlit/whoop/db.py:314-360 (sync_body_measurement).
// Whoop's payload has no timestamp — values are "current". Dedupe by comparing
// against the latest stored row, so we don't pile up identical rows per sync.
export function upsertBodyMeasurement(
  body: WhoopBodyMeasurement | null | undefined,
  userId: number,
): boolean {
  if (!body) return false;
  const height = body.height_meter ?? null;
  const weight = body.weight_kilogram ?? null;
  const maxHr = body.max_heart_rate ?? null;
  if (height === null && weight === null && maxHr === null) return false;
  const db = openWrite();
  if (!db) return false;
  try {
    const latest = db
      .prepare(
        "SELECT height_meter, weight_kilogram, max_heart_rate " +
          "FROM body_measurements WHERE user_id = ? " +
          "ORDER BY measured_at DESC LIMIT 1",
      )
      .get(userId) as
      | {
          height_meter: number | null;
          weight_kilogram: number | null;
          max_heart_rate: number | null;
        }
      | undefined;
    if (
      latest &&
      latest.height_meter === height &&
      latest.weight_kilogram === weight &&
      latest.max_heart_rate === maxHr
    ) {
      return false;
    }
    db.prepare(
      "INSERT INTO body_measurements " +
        "(user_id, height_meter, weight_kilogram, max_heart_rate, measured_at, raw) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      userId,
      height,
      weight,
      maxHr,
      new Date().toISOString(),
      JSON.stringify(body),
    );
    return true;
  } finally {
    db.close();
  }
}

export function upsertRecovery(record: WhoopRecoveryRecord, userId: number, tz: string): boolean {
  if (record.score_state !== "SCORED" || !record.score) return false;
  const db = openWrite();
  if (!db) return false;
  try {
    // KEEP IN SYNC WITH streamlit/whoop/db.py:147-166 (sync_recovery column order)
    db.prepare(`
      INSERT OR REPLACE INTO recovery
        (user_id, date, recovery_score, hrv, rhr, spo2, skin_temp, raw)
      VALUES
        (@user_id, @date, @recovery_score, @hrv, @rhr, @spo2, @skin_temp, @raw)
    `).run({
      user_id: userId,
      date: parseDate(record.created_at, tz),
      recovery_score: record.score.recovery_score,
      hrv: record.score.hrv_rmssd_milli,
      rhr: record.score.resting_heart_rate,
      spo2: record.score.spo2_percentage ?? null,
      skin_temp: record.score.skin_temp_celsius ?? null,
      raw: JSON.stringify(record),
    });
    return true;
  } finally {
    db.close();
  }
}

export function upsertWorkout(record: WhoopWorkoutRecord, userId: number, tz: string): boolean {
  if (record.score_state !== "SCORED" || !record.score) return false;
  const db = openWrite();
  if (!db) return false;
  let reconciledDates: string[] = [];
  try {
    const zd = record.score.zone_durations;
    const durationSec =
      (new Date(record.end).getTime() - new Date(record.start).getTime()) / 1000;
    // KEEP IN SYNC WITH streamlit/whoop/db.py:229-261 (sync_workouts column order)
    db.prepare(`
      INSERT OR REPLACE INTO workouts
        (user_id, id, date, sport, duration_sec, avg_hr, max_hr, strain, kilojoule,
         distance_m, zone_0_ms, zone_1_ms, zone_2_ms, zone_3_ms, zone_4_ms, zone_5_ms, raw)
      VALUES
        (@user_id, @id, @date, @sport, @duration_sec, @avg_hr, @max_hr, @strain, @kilojoule,
         @distance_m, @zone_0_ms, @zone_1_ms, @zone_2_ms, @zone_3_ms, @zone_4_ms, @zone_5_ms, @raw)
    `).run({
      user_id: userId,
      id: record.id,
      date: parseDate(record.start, tz),
      sport: record.sport_name ?? "Unknown",
      duration_sec: durationSec,
      avg_hr: record.score.average_heart_rate,
      max_hr: record.score.max_heart_rate,
      strain: record.score.strain,
      kilojoule: record.score.kilojoule,
      distance_m: record.score.distance_meter ?? null,
      zone_0_ms: zd.zone_zero_milli,
      zone_1_ms: zd.zone_one_milli,
      zone_2_ms: zd.zone_two_milli,
      zone_3_ms: zd.zone_three_milli,
      zone_4_ms: zd.zone_four_milli,
      zone_5_ms: zd.zone_five_milli,
      raw: JSON.stringify(record),
    });
    // Reverse-dedup: if a HealthKit-only row was inserted before Whoop synced
    // this same session (dual-wear race / Apple data lands before Whoop cloud
    // scoring), reconcile it onto this Whoop row so we never keep two rows for
    // one session (which would double-count every aggregation).
    reconciledDates = reconcileHealthKitDuplicate(
      db,
      record.id,
      record.start,
      record.sport_name ?? null,
      userId,
    );
  } finally {
    db.close();
  }
  // A reconciled HK row was deleted from its day — refresh that day's rollup.
  for (const date of new Set(reconciledDates)) recomputeDailySummary(date, userId);
  return true;
}

type HkDupRow = {
  id: string;
  sport: string | null;
  hr_series: string | null;
  external_id: string | null;
  distance_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  date: string;
  start_utc: string | null;
};

/**
 * Find any `source='healthkit'` row that is the same session as a just-upserted
 * Whoop row (within ±60s start + compatible sport), transfer its HR stream and
 * external_id onto the Whoop row (COALESCE — never clobber existing values),
 * then delete the HK row. Returns the deleted HK rows' dates so the caller can
 * refresh `daily_summary`. Runs on the caller's open write connection.
 */
export function reconcileHealthKitDuplicate(
  db: DB,
  whoopId: string,
  startUtc: string,
  sport: string | null,
  userId: number,
): string[] {
  const startMs = new Date(startUtc).getTime();
  if (!Number.isFinite(startMs)) return [];
  const loIso = new Date(startMs - SQL_WINDOW_MS).toISOString();
  const hiIso = new Date(startMs + SQL_WINDOW_MS).toISOString();

  const candidates = db
    .prepare(
      `SELECT id, sport, hr_series, external_id, distance_m, avg_hr, max_hr, date,
              json_extract(raw, '$.start') AS start_utc
       FROM workouts
       WHERE source = 'healthkit' AND id != ? AND user_id = ?
         AND json_extract(raw, '$.start') >= ? AND json_extract(raw, '$.start') <= ?`,
    )
    .all(whoopId, userId, loIso, hiIso) as HkDupRow[];

  const transfer = db.prepare(
    `UPDATE workouts SET
       hr_series   = COALESCE(hr_series, @hr_series),
       external_id = COALESCE(external_id, @external_id),
       distance_m  = COALESCE(distance_m, @distance_m),
       avg_hr      = COALESCE(avg_hr, @avg_hr),
       max_hr      = COALESCE(max_hr, @max_hr)
     WHERE id = @whoopId AND user_id = @user_id`,
  );
  const del = db.prepare("DELETE FROM workouts WHERE id = ? AND user_id = ?");

  const dates: string[] = [];
  for (const c of candidates) {
    if (!c.start_utc) continue;
    if (!sportsCompatible(c.sport, sport)) continue;
    if (Math.abs(new Date(c.start_utc).getTime() - startMs) > MATCH_WINDOW_MS) continue;
    transfer.run({
      whoopId,
      user_id: userId,
      hr_series: c.hr_series,
      external_id: c.external_id,
      distance_m: c.distance_m,
      avg_hr: c.avg_hr,
      max_hr: c.max_hr,
    });
    del.run(c.id, userId);
    dates.push(c.date);
  }
  return dates;
}

// Shared SQL constants — KEEP IN SYNC WITH sync/daily_summary.py:26-91
//
// Phase D: every CTE join scopes to user_id so user A's recovery doesn't
// poison user B's daily_summary row. Param order is consistent across the
// whole SELECT — `?` (date), `?` (date), `?` (user_id for workout_summary),
// `?` (user_id for recovery join), `?` (user_id for sleep join), `?` (user_id
// for cycles join). The Python rollup at sync/daily_summary.py is single-
// tenant today and stays unchanged — see the "KEEP IN SYNC" note above.

const SELECT_DAILY_SUMMARY = `
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
-- KEEP THIS SUBSELECT IN SYNC WITH sync.ts's SUMMARY_SELECT_SQL and with
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

const INSERT_DAILY_SUMMARY = `
INSERT OR REPLACE INTO daily_summary (
    user_id, date, recovery_score, hrv_ms, resting_hr, sleep_hours, sleep_efficiency,
    sleep_performance, day_strain, max_hr, avg_hr, kilojoules, workouts_count
) VALUES (
    @user_id, @date, @recovery_score, @hrv_ms, @resting_hr, @sleep_hours, @sleep_efficiency,
    @sleep_performance, @day_strain, @max_hr, @avg_hr, @kilojoules, @workouts_count
)
`;

function _recomputeInDb(db: DB, date: string, userId: number): void {
  // WITH day(...) always returns exactly one row, so no null guard needed.
  const row = db
    .prepare(SELECT_DAILY_SUMMARY)
    .get(date, date, userId, userId, userId, userId) as Record<string, unknown>;
  db.prepare(INSERT_DAILY_SUMMARY).run({ ...row, user_id: userId });
}

export function recomputeDailySummary(date: string, userId: number): boolean {
  const db = openWrite();
  if (!db) return false;
  try {
    _recomputeInDb(db, date, userId);
    return true;
  } finally {
    db.close();
  }
}

// Combined lookup+delete+recompute in a single DB connection per handler.
// Returns the affected date (for logging), or null if the row didn't exist
// (idempotent re-delivery — caller should return 200 without retrying).

export function deleteSleepAndRecompute(
  sleepId: string,
  userId: number,
): string | null {
  const db = openWrite();
  if (!db) return null;
  try {
    return db.transaction(() => {
      const row = db
        .prepare(
          "SELECT date FROM sleep WHERE json_extract(raw, '$.id') = ? AND user_id = ? LIMIT 1",
        )
        .get(sleepId, userId) as { date: string } | undefined;
      if (!row) return null;
      db.prepare(
        "DELETE FROM sleep WHERE json_extract(raw, '$.id') = ? AND user_id = ?",
      ).run(sleepId, userId);
      _recomputeInDb(db, row.date, userId);
      return row.date;
    })();
  } finally {
    db.close();
  }
}

export function deleteWorkoutAndRecompute(
  workoutId: string,
  userId: number,
): string | null {
  const db = openWrite();
  if (!db) return null;
  try {
    return db.transaction(() => {
      const row = db
        .prepare(
          "SELECT date FROM workouts WHERE id = ? AND user_id = ? LIMIT 1",
        )
        .get(workoutId, userId) as { date: string } | undefined;
      if (!row) return null;
      db.prepare("DELETE FROM workouts WHERE id = ? AND user_id = ?").run(
        workoutId,
        userId,
      );
      _recomputeInDb(db, row.date, userId);
      return row.date;
    })();
  } finally {
    db.close();
  }
}

export function deleteRecoveryAndRecompute(
  sleepId: string,
  userId: number,
): string | null {
  const db = openWrite();
  if (!db) return null;
  try {
    return db.transaction(() => {
      const row = db
        .prepare(
          "SELECT date FROM recovery WHERE json_extract(raw, '$.sleep_id') = ? AND user_id = ? LIMIT 1",
        )
        .get(sleepId, userId) as { date: string } | undefined;
      if (!row) return null;
      db.prepare(
        "DELETE FROM recovery WHERE json_extract(raw, '$.sleep_id') = ? AND user_id = ?",
      ).run(sleepId, userId);
      _recomputeInDb(db, row.date, userId);
      return row.date;
    })();
  } finally {
    db.close();
  }
}
