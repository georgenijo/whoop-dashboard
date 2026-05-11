"""Python-side SQLite helpers retained for scripts (migrate-whoop-tokens.py,
wal_smoke.py) and the pytest suite in tests/. The 5 Whoop domain tables
(recovery / cycles / sleep / workouts / daily_summary) are now owned by the
Next.js side — Phase D rebuilt them with composite (user_id, date) PKs.
Python code that wanted to write them was deleted in the same PR; keep this
module read-only against those tables.
"""
import os
import sqlite3

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


def init_db() -> None:
    """Bootstrap only the Python-owned tables used by scripts/tests.

    The 5 Whoop domain tables (recovery / cycles / sleep / workouts /
    daily_summary) are bootstrapped + migrated by the Next.js openWrite()
    path — DO NOT create them here. wal_smoke.py reads from recovery/cycles;
    callers must have run the Next.js side at least once against the DB.
    """
    conn = get_conn()
    conn.executescript(
        """
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
