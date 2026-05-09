import json
import os
import sqlite3
from datetime import datetime, timedelta

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
DB_PATH = os.environ.get(
    "WHOOP_DB_PATH",
    os.path.join(_REPO_ROOT, "shared", "whoop_data.db"),
)
TOKENS_JSON_PATH = os.path.join(_REPO_ROOT, "tokens.json")


def get_conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
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
            need_from_baseline_ms INTEGER,
            need_from_debt_ms INTEGER,
            need_from_strain_ms INTEGER,
            need_from_nap_ms INTEGER,
            start_local TEXT,
            end_local TEXT,
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
        CREATE TABLE IF NOT EXISTS body_measurements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL DEFAULT 1,
            height_meter REAL,
            weight_kilogram REAL,
            max_heart_rate INTEGER,
            measured_at TEXT NOT NULL,
            raw JSON
        );
        CREATE INDEX IF NOT EXISTS idx_body_measurements_user_measured
            ON body_measurements(user_id, measured_at DESC);
        CREATE TABLE IF NOT EXISTS insights (
            date TEXT PRIMARY KEY,
            insight TEXT,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS signals (
            date TEXT NOT NULL,
            signal TEXT NOT NULL,
            value REAL,
            raw JSON,
            computed_at TEXT,
            PRIMARY KEY (date, signal)
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


def _to_local_iso(utc_str: str | None, tz_offset: str | None) -> str | None:
    if not utc_str or not tz_offset:
        return None
    try:
        utc_dt = datetime.fromisoformat(utc_str.replace("Z", "+00:00"))
        sign = 1 if tz_offset[0] == "+" else -1
        hh, mm = tz_offset[1:].split(":")
        delta = sign * (int(hh) * 60 + int(mm))
        local_dt = utc_dt + timedelta(minutes=delta)
        return local_dt.strftime("%Y-%m-%dT%H:%M:%S")
    except (ValueError, IndexError):
        return None


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
        tz_offset = r.get("timezone_offset")
        start_local = _to_local_iso(r.get("start"), tz_offset)
        end_local = _to_local_iso(r.get("end"), tz_offset)
        conn.execute(
            """
            INSERT OR REPLACE INTO sleep
                (date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms,
                 performance, efficiency, consistency, respiratory_rate,
                 disturbances, cycles, nap,
                 need_from_baseline_ms, need_from_debt_ms, need_from_strain_ms, need_from_nap_ms,
                 start_local, end_local,
                 raw)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
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
                sn["baseline_milli"],
                sn["need_from_sleep_debt_milli"],
                sn["need_from_recent_strain_milli"],
                sn["need_from_recent_nap_milli"],
                start_local,
                end_local,
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


def sync_body_measurement(body: dict | None, user_id: int = 1) -> bool:
    """Persist Whoop body measurement if it differs from the latest stored row.

    Whoop's payload has no timestamp — values are "current". We dedupe by
    comparing height/weight/max_hr against the most recent row to avoid one
    row per sync.
    """
    if not body:
        return False
    height = body.get("height_meter")
    weight = body.get("weight_kilogram")
    max_hr = body.get("max_heart_rate")
    if height is None and weight is None and max_hr is None:
        return False

    conn = get_conn()
    latest = conn.execute(
        "SELECT height_meter, weight_kilogram, max_heart_rate "
        "FROM body_measurements WHERE user_id = ? "
        "ORDER BY measured_at DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    if (
        latest is not None
        and latest["height_meter"] == height
        and latest["weight_kilogram"] == weight
        and latest["max_heart_rate"] == max_hr
    ):
        conn.close()
        return False

    conn.execute(
        "INSERT INTO body_measurements "
        "(user_id, height_meter, weight_kilogram, max_heart_rate, measured_at, raw) "
        "VALUES (?,?,?,?,?,?)",
        (
            user_id,
            height,
            weight,
            max_hr,
            datetime.utcnow().isoformat(),
            json.dumps(body),
        ),
    )
    conn.commit()
    conn.close()
    return True


def sync_all(data: dict):
    init_db()
    sync_recovery(data.get("recovery", []))
    sync_cycles(data.get("cycles", []))
    sync_sleep(data.get("sleep", []))
    sync_workouts(data.get("workouts", []))
    sync_body_measurement(data.get("body"))


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


def get_workout_history() -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT date, sport, duration_sec, avg_hr FROM workouts "
        "WHERE avg_hr IS NOT NULL AND duration_sec IS NOT NULL ORDER BY date ASC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


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
        "performance, efficiency, disturbances, respiratory_rate FROM sleep WHERE COALESCE(nap, 0) = 0 ORDER BY date DESC LIMIT ?",
        (days,),
    ).fetchall()
    stats["sleep"] = [dict(r) for r in sleep]

    workouts = conn.execute(
        "SELECT date, sport, duration_sec, strain, avg_hr FROM workouts ORDER BY date DESC LIMIT ?",
        (days,),
    ).fetchall()
    stats["workouts"] = [dict(r) for r in workouts]

    return stats


def upsert_signal(
    date: str,
    signal: str,
    value: float | None,
    raw: dict | None = None,
    computed_at: str | None = None,
) -> None:
    conn = get_conn()
    conn.execute(
        "INSERT OR REPLACE INTO signals VALUES (?,?,?,?,?)",
        (
            date,
            signal,
            value,
            json.dumps(raw) if raw is not None else None,
            computed_at or datetime.utcnow().isoformat(),
        ),
    )
    conn.commit()
    conn.close()


