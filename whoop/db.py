import json
import os
import sqlite3
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "whoop_data.db")


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    conn = get_conn()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS recovery (
            date TEXT PRIMARY KEY,
            recovery_score REAL,
            hrv REAL,
            rhr REAL,
            spo2 REAL,
            skin_temp REAL,
            raw JSON
        );
        CREATE TABLE IF NOT EXISTS cycles (
            date TEXT PRIMARY KEY,
            strain REAL,
            kilojoule REAL,
            avg_hr INTEGER,
            max_hr INTEGER,
            raw JSON
        );
        CREATE TABLE IF NOT EXISTS sleep (
            date TEXT PRIMARY KEY,
            in_bed_ms INTEGER,
            light_ms INTEGER,
            deep_ms INTEGER,
            rem_ms INTEGER,
            awake_ms INTEGER,
            sleep_need_ms INTEGER,
            performance REAL,
            efficiency REAL,
            consistency REAL,
            respiratory_rate REAL,
            disturbances INTEGER,
            cycles INTEGER,
            nap BOOLEAN,
            raw JSON
        );
        CREATE TABLE IF NOT EXISTS workouts (
            id TEXT PRIMARY KEY,
            date TEXT,
            sport TEXT,
            duration_sec REAL,
            avg_hr INTEGER,
            max_hr INTEGER,
            strain REAL,
            kilojoule REAL,
            distance_m REAL,
            zone_0_ms INTEGER,
            zone_1_ms INTEGER,
            zone_2_ms INTEGER,
            zone_3_ms INTEGER,
            zone_4_ms INTEGER,
            zone_5_ms INTEGER,
            raw JSON
        );
        CREATE TABLE IF NOT EXISTS insights (
            date TEXT PRIMARY KEY,
            insight TEXT,
            created_at TEXT
        );
        """
    )
    conn.close()


def _parse_date(iso_str: str) -> str:
    return datetime.fromisoformat(iso_str.replace("Z", "+00:00")).strftime("%Y-%m-%d")


def sync_recovery(records: list):
    conn = get_conn()
    for r in records:
        if r.get("score_state") != "SCORED":
            continue
        s = r["score"]
        date = _parse_date(r["created_at"])
        conn.execute(
            "INSERT OR REPLACE INTO recovery VALUES (?,?,?,?,?,?,?)",
            (
                date,
                s["recovery_score"],
                s["hrv_rmssd_milli"],
                s["resting_heart_rate"],
                s.get("spo2_percentage"),
                s.get("skin_temp_celsius"),
                json.dumps(r),
            ),
        )
    conn.commit()
    conn.close()


def sync_cycles(records: list):
    conn = get_conn()
    for r in records:
        if r.get("score_state") != "SCORED":
            continue
        s = r["score"]
        date = _parse_date(r["start"])
        conn.execute(
            "INSERT OR REPLACE INTO cycles VALUES (?,?,?,?,?,?)",
            (
                date,
                s["strain"],
                s["kilojoule"],
                s["average_heart_rate"],
                s["max_heart_rate"],
                json.dumps(r),
            ),
        )
    conn.commit()
    conn.close()


def sync_sleep(records: list):
    conn = get_conn()
    for r in records:
        if r.get("score_state") != "SCORED":
            continue
        s = r["score"]
        ss = s["stage_summary"]
        sn = s["sleep_needed"]
        date = _parse_date(r["start"])
        total_need = (
            sn["baseline_milli"]
            + sn["need_from_sleep_debt_milli"]
            + sn["need_from_recent_strain_milli"]
            + sn["need_from_recent_nap_milli"]
        )
        conn.execute(
            "INSERT OR REPLACE INTO sleep VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                date,
                ss["total_in_bed_time_milli"],
                ss["total_light_sleep_time_milli"],
                ss["total_slow_wave_sleep_time_milli"],
                ss["total_rem_sleep_time_milli"],
                ss["total_awake_time_milli"],
                total_need,
                s.get("sleep_performance_percentage"),
                s.get("sleep_efficiency_percentage"),
                s.get("sleep_consistency_percentage"),
                s.get("respiratory_rate"),
                ss["disturbance_count"],
                ss["sleep_cycle_count"],
                r.get("nap", False),
                json.dumps(r),
            ),
        )
    conn.commit()
    conn.close()


def sync_workouts(records: list):
    conn = get_conn()
    for r in records:
        if r.get("score_state") != "SCORED":
            continue
        s = r["score"]
        zd = s["zone_durations"]
        start = datetime.fromisoformat(r["start"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(r["end"].replace("Z", "+00:00"))
        conn.execute(
            "INSERT OR REPLACE INTO workouts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                r["id"],
                _parse_date(r["start"]),
                r.get("sport_name", "Unknown"),
                (end - start).total_seconds(),
                s["average_heart_rate"],
                s["max_heart_rate"],
                s["strain"],
                s["kilojoule"],
                s.get("distance_meter"),
                zd["zone_zero_milli"],
                zd["zone_one_milli"],
                zd["zone_two_milli"],
                zd["zone_three_milli"],
                zd["zone_four_milli"],
                zd["zone_five_milli"],
                json.dumps(r),
            ),
        )
    conn.commit()
    conn.close()


def sync_all(data: dict):
    init_db()
    sync_recovery(data.get("recovery", []))
    sync_cycles(data.get("cycles", []))
    sync_sleep(data.get("sleep", []))
    sync_workouts(data.get("workouts", []))


def save_insight(date: str, insight: str):
    conn = get_conn()
    conn.execute(
        "INSERT OR REPLACE INTO insights VALUES (?,?,?)",
        (date, insight, datetime.utcnow().isoformat()),
    )
    conn.commit()
    conn.close()


def get_latest_insight() -> str | None:
    conn = get_conn()
    row = conn.execute(
        "SELECT insight FROM insights ORDER BY date DESC LIMIT 1"
    ).fetchone()
    conn.close()
    return row["insight"] if row else None


def get_history_stats(days: int = 30) -> dict:
    conn = get_conn()
    stats = {}

    recovery = conn.execute(
        "SELECT * FROM recovery ORDER BY date DESC LIMIT ?", (days,)
    ).fetchall()
    stats["recovery"] = [dict(r) for r in recovery]

    cycles = conn.execute(
        "SELECT * FROM cycles ORDER BY date DESC LIMIT ?", (days,)
    ).fetchall()
    stats["cycles"] = [dict(r) for r in cycles]

    sleep = conn.execute(
        "SELECT date, in_bed_ms, deep_ms, rem_ms, light_ms, awake_ms, sleep_need_ms, "
        "performance, efficiency, disturbances, respiratory_rate FROM sleep WHERE nap = 0 ORDER BY date DESC LIMIT ?",
        (days,),
    ).fetchall()
    stats["sleep"] = [dict(r) for r in sleep]

    workouts = conn.execute(
        "SELECT date, sport, duration_sec, strain, avg_hr FROM workouts ORDER BY date DESC LIMIT ?",
        (days,),
    ).fetchall()
    stats["workouts"] = [dict(r) for r in workouts]

    return stats
