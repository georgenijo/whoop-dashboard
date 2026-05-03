import "server-only";
import { openWrite } from "@/lib/db/connection";

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

export function parseDate(iso: string): string {
  // YYYY-MM-DD in UTC, matching streamlit/whoop/db.py:143-144 (_parse_date).
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
    const totalNeed =
      sn.baseline_milli +
      sn.need_from_sleep_debt_milli +
      sn.need_from_recent_strain_milli +
      sn.need_from_recent_nap_milli;
    db.prepare(
      "INSERT OR REPLACE INTO sleep VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      parseDate(record.start),
      ss.total_in_bed_time_milli,
      ss.total_light_sleep_time_milli,
      ss.total_slow_wave_sleep_time_milli,
      ss.total_rem_sleep_time_milli,
      ss.total_awake_time_milli,
      totalNeed,
      record.score.sleep_performance_percentage ?? null,
      record.score.sleep_efficiency_percentage ?? null,
      record.score.sleep_consistency_percentage ?? null,
      record.score.respiratory_rate ?? null,
      ss.disturbance_count,
      ss.sleep_cycle_count,
      record.nap ? 1 : 0,
      JSON.stringify(record),
    );
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
    db.prepare(
      "INSERT OR REPLACE INTO recovery VALUES (?,?,?,?,?,?,?)",
    ).run(
      parseDate(record.created_at),
      record.score.recovery_score,
      record.score.hrv_rmssd_milli,
      record.score.resting_heart_rate,
      record.score.spo2_percentage ?? null,
      record.score.skin_temp_celsius ?? null,
      JSON.stringify(record),
    );
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
    const startMs = new Date(record.start).getTime();
    const endMs = new Date(record.end).getTime();
    const durationSec = (endMs - startMs) / 1000;
    db.prepare(
      "INSERT OR REPLACE INTO workouts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      record.id,
      parseDate(record.start),
      record.sport_name ?? "Unknown",
      durationSec,
      record.score.average_heart_rate,
      record.score.max_heart_rate,
      record.score.strain,
      record.score.kilojoule,
      record.score.distance_meter ?? null,
      zd.zone_zero_milli,
      zd.zone_one_milli,
      zd.zone_two_milli,
      zd.zone_three_milli,
      zd.zone_four_milli,
      zd.zone_five_milli,
      JSON.stringify(record),
    );
    return true;
  } finally {
    db.close();
  }
}

export function lookupSleepDateById(sleepId: string): string | null {
  const db = openWrite();
  if (!db) return null;
  try {
    const row = db
      .prepare("SELECT date FROM sleep WHERE json_extract(raw, '$.id') = ? LIMIT 1")
      .get(sleepId) as { date: string } | undefined;
    return row?.date ?? null;
  } finally {
    db.close();
  }
}

export function lookupWorkoutDateById(workoutId: string): string | null {
  const db = openWrite();
  if (!db) return null;
  try {
    const row = db
      .prepare("SELECT date FROM workouts WHERE id = ? LIMIT 1")
      .get(workoutId) as { date: string } | undefined;
    return row?.date ?? null;
  } finally {
    db.close();
  }
}

export function lookupRecoveryDateBySleepId(sleepId: string): string | null {
  const db = openWrite();
  if (!db) return null;
  try {
    const row = db
      .prepare(
        "SELECT date FROM recovery WHERE json_extract(raw, '$.sleep_id') = ? LIMIT 1",
      )
      .get(sleepId) as { date: string } | undefined;
    return row?.date ?? null;
  } finally {
    db.close();
  }
}

export function deleteSleepById(sleepId: string): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare("DELETE FROM sleep WHERE json_extract(raw, '$.id') = ?").run(sleepId);
  } finally {
    db.close();
  }
}

export function deleteWorkoutById(workoutId: string): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare("DELETE FROM workouts WHERE id = ?").run(workoutId);
  } finally {
    db.close();
  }
}

export function deleteRecoveryBySleepId(sleepId: string): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      "DELETE FROM recovery WHERE json_extract(raw, '$.sleep_id') = ?",
    ).run(sleepId);
  } finally {
    db.close();
  }
}

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
    date,
    recovery_score,
    hrv_ms,
    resting_hr,
    sleep_hours,
    sleep_efficiency,
    sleep_performance,
    day_strain,
    max_hr,
    avg_hr,
    kilojoules,
    workouts_count
) VALUES (
    @date,
    @recovery_score,
    @hrv_ms,
    @resting_hr,
    @sleep_hours,
    @sleep_efficiency,
    @sleep_performance,
    @day_strain,
    @max_hr,
    @avg_hr,
    @kilojoules,
    @workouts_count
)
`;

export function recomputeDailySummary(date: string): boolean {
  const db = openWrite();
  if (!db) return false;
  try {
    const row = db.prepare(SELECT_DAILY_SUMMARY).get(date, date) as
      | Record<string, unknown>
      | undefined;
    if (!row) return false;
    db.prepare(INSERT_DAILY_SUMMARY).run(row);
    return true;
  } finally {
    db.close();
  }
}
