import "server-only";
import { openWrite, type DB } from "@/lib/db/connection";

// KEEP IN SYNC WITH streamlit/whoop/db.py:147-262 (column lists for recovery/cycles/sleep/workouts)
// KEEP IN SYNC WITH sync/daily_summary.py:26-91 (SELECT/INSERT_DAILY_SUMMARY SQL)

export type WhoopSleepRecord = {
  id: string;
  start: string;
  end?: string;
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

// Whoop V2 sends Z-suffix timestamps throughout; `new Date(iso).toISOString()`
// therefore produces the same UTC date as Python's _parse_date (streamlit/whoop/db.py:143-144).
// If Whoop ever sends a non-Z offset, this would diverge — safe assumption for V2.
export function parseDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function sleepSummaryDate(r: WhoopSleepRecord): string {
  return parseDate(r.start);
}

export function workoutSummaryDate(r: WhoopWorkoutRecord): string {
  return parseDate(r.start);
}

export function recoverySummaryDate(r: WhoopRecoveryRecord): string {
  return parseDate(r.created_at);
}

export function upsertSleep(record: WhoopSleepRecord): boolean {
  if (record.score_state !== "SCORED" || !record.score) return false;
  const db = openWrite();
  if (!db) return false;
  try {
    const ss = record.score.stage_summary;
    const sn = record.score.sleep_needed;
    // KEEP IN SYNC WITH streamlit/whoop/db.py:200-227 (sync_sleep column order)
    db.prepare(`
      INSERT OR REPLACE INTO sleep
        (date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms,
         performance, efficiency, consistency, respiratory_rate,
         disturbances, cycles, nap,
         need_from_baseline_ms, need_from_debt_ms, need_from_strain_ms, need_from_nap_ms,
         raw)
      VALUES
        (@date, @in_bed_ms, @light_ms, @deep_ms, @rem_ms, @awake_ms, @sleep_need_ms,
         @performance, @efficiency, @consistency, @respiratory_rate,
         @disturbances, @cycles, @nap,
         @need_from_baseline_ms, @need_from_debt_ms, @need_from_strain_ms, @need_from_nap_ms,
         @raw)
    `).run({
      date: parseDate(record.start),
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
      raw: JSON.stringify(record),
    });
    return true;
  } finally {
    db.close();
  }
}

export function upsertRecovery(record: WhoopRecoveryRecord): boolean {
  if (record.score_state !== "SCORED" || !record.score) return false;
  const db = openWrite();
  if (!db) return false;
  try {
    // KEEP IN SYNC WITH streamlit/whoop/db.py:147-166 (sync_recovery column order)
    db.prepare(`
      INSERT OR REPLACE INTO recovery
        (date, recovery_score, hrv, rhr, spo2, skin_temp, raw)
      VALUES
        (@date, @recovery_score, @hrv, @rhr, @spo2, @skin_temp, @raw)
    `).run({
      date: parseDate(record.created_at),
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

export function upsertWorkout(record: WhoopWorkoutRecord): boolean {
  if (record.score_state !== "SCORED" || !record.score) return false;
  const db = openWrite();
  if (!db) return false;
  try {
    const zd = record.score.zone_durations;
    const durationSec =
      (new Date(record.end).getTime() - new Date(record.start).getTime()) / 1000;
    // KEEP IN SYNC WITH streamlit/whoop/db.py:229-261 (sync_workouts column order)
    db.prepare(`
      INSERT OR REPLACE INTO workouts
        (id, date, sport, duration_sec, avg_hr, max_hr, strain, kilojoule,
         distance_m, zone_0_ms, zone_1_ms, zone_2_ms, zone_3_ms, zone_4_ms, zone_5_ms, raw)
      VALUES
        (@id, @date, @sport, @duration_sec, @avg_hr, @max_hr, @strain, @kilojoule,
         @distance_m, @zone_0_ms, @zone_1_ms, @zone_2_ms, @zone_3_ms, @zone_4_ms, @zone_5_ms, @raw)
    `).run({
      id: record.id,
      date: parseDate(record.start),
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
    return true;
  } finally {
    db.close();
  }
}

// Shared SQL constants — KEEP IN SYNC WITH sync/daily_summary.py:26-91

const SELECT_DAILY_SUMMARY = `
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

const INSERT_DAILY_SUMMARY = `
INSERT OR REPLACE INTO daily_summary (
    date, recovery_score, hrv_ms, resting_hr, sleep_hours, sleep_efficiency,
    sleep_performance, day_strain, max_hr, avg_hr, kilojoules, workouts_count
) VALUES (
    @date, @recovery_score, @hrv_ms, @resting_hr, @sleep_hours, @sleep_efficiency,
    @sleep_performance, @day_strain, @max_hr, @avg_hr, @kilojoules, @workouts_count
)
`;

function _recomputeInDb(db: DB, date: string): void {
  // WITH day(...) always returns exactly one row, so no null guard needed.
  const row = db.prepare(SELECT_DAILY_SUMMARY).get(date, date) as Record<string, unknown>;
  db.prepare(INSERT_DAILY_SUMMARY).run(row);
}

export function recomputeDailySummary(date: string): boolean {
  const db = openWrite();
  if (!db) return false;
  try {
    _recomputeInDb(db, date);
    return true;
  } finally {
    db.close();
  }
}

// Combined lookup+delete+recompute in a single DB connection per handler.
// Returns the affected date (for logging), or null if the row didn't exist
// (idempotent re-delivery — caller should return 200 without retrying).

export function deleteSleepAndRecompute(sleepId: string): string | null {
  const db = openWrite();
  if (!db) return null;
  try {
    return db.transaction(() => {
      const row = db
        .prepare("SELECT date FROM sleep WHERE json_extract(raw, '$.id') = ? LIMIT 1")
        .get(sleepId) as { date: string } | undefined;
      if (!row) return null;
      db.prepare("DELETE FROM sleep WHERE json_extract(raw, '$.id') = ?").run(sleepId);
      _recomputeInDb(db, row.date);
      return row.date;
    })();
  } finally {
    db.close();
  }
}

export function deleteWorkoutAndRecompute(workoutId: string): string | null {
  const db = openWrite();
  if (!db) return null;
  try {
    return db.transaction(() => {
      const row = db
        .prepare("SELECT date FROM workouts WHERE id = ? LIMIT 1")
        .get(workoutId) as { date: string } | undefined;
      if (!row) return null;
      db.prepare("DELETE FROM workouts WHERE id = ?").run(workoutId);
      _recomputeInDb(db, row.date);
      return row.date;
    })();
  } finally {
    db.close();
  }
}

export function deleteRecoveryAndRecompute(sleepId: string): string | null {
  const db = openWrite();
  if (!db) return null;
  try {
    return db.transaction(() => {
      const row = db
        .prepare(
          "SELECT date FROM recovery WHERE json_extract(raw, '$.sleep_id') = ? LIMIT 1",
        )
        .get(sleepId) as { date: string } | undefined;
      if (!row) return null;
      db.prepare(
        "DELETE FROM recovery WHERE json_extract(raw, '$.sleep_id') = ?",
      ).run(sleepId);
      _recomputeInDb(db, row.date);
      return row.date;
    })();
  } finally {
    db.close();
  }
}
