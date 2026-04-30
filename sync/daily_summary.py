"""Materialize one daily metrics row for fast dashboard reads."""

import os
import sqlite3


SCHEMA = """
CREATE TABLE IF NOT EXISTS daily_summary (
    date TEXT PRIMARY KEY,
    recovery_score INTEGER,
    hrv_ms REAL,
    resting_hr INTEGER,
    sleep_hours REAL,
    sleep_efficiency REAL,
    sleep_performance INTEGER,
    day_strain REAL,
    max_hr INTEGER,
    avg_hr INTEGER,
    kilojoules REAL,
    workouts_count INTEGER,
    computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_daily_summary_date ON daily_summary(date DESC);
"""

SELECT_DAILY_SUMMARY = """
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
"""

INSERT_DAILY_SUMMARY = """
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
    :date,
    :recovery_score,
    :hrv_ms,
    :resting_hr,
    :sleep_hours,
    :sleep_efficiency,
    :sleep_performance,
    :day_strain,
    :max_hr,
    :avg_hr,
    :kilojoules,
    :workouts_count
)
"""


def _get_conn(db_path: str) -> sqlite3.Connection:
    db_dir = os.path.dirname(db_path)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def compute_daily_summary(db_path: str, dates: list[str]) -> int:
    unique_dates = sorted({date for date in dates if date})
    conn = _get_conn(db_path)
    try:
        conn.executescript(SCHEMA)
        for date in unique_dates:
            row = conn.execute(SELECT_DAILY_SUMMARY, (date, date)).fetchone()
            if row is not None:
                conn.execute(INSERT_DAILY_SUMMARY, dict(row))
        conn.commit()
    finally:
        conn.close()
    return len(unique_dates)
