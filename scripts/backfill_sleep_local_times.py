#!/usr/bin/env python3
"""Backfill start_local/end_local on sleep rows from raw JSON.

Idempotent: only updates rows where start_local OR end_local is NULL and raw is non-null.
"""

import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB = os.path.join(REPO_ROOT, "shared", "whoop_data.db")


def to_local_iso(utc_str, tz_offset):
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


def main():
    db_path = os.environ.get("WHOOP_DB_PATH", DEFAULT_DB)
    if not os.path.exists(db_path):
        print(f"ERROR: db not found at {db_path}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cols = {row[1] for row in cur.execute("PRAGMA table_info(sleep)").fetchall()}
    for col in ("start_local", "end_local"):
        if col not in cols:
            cur.execute(f"ALTER TABLE sleep ADD COLUMN {col} TEXT")
            conn.commit()

    rows = cur.execute(
        "SELECT date, raw FROM sleep WHERE raw IS NOT NULL "
        "AND (start_local IS NULL OR end_local IS NULL)"
    ).fetchall()

    updated = 0
    skipped = 0
    for date, raw in rows:
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            skipped += 1
            continue
        tz_offset = data.get("timezone_offset")
        start_local = to_local_iso(data.get("start"), tz_offset)
        end_local = to_local_iso(data.get("end"), tz_offset)
        if start_local is None and end_local is None:
            skipped += 1
            continue
        cur.execute(
            "UPDATE sleep SET start_local = COALESCE(?, start_local), "
            "end_local = COALESCE(?, end_local) WHERE date = ?",
            (start_local, end_local, date),
        )
        updated += 1

    conn.commit()
    conn.close()
    print(f"Backfilled {updated} rows ({skipped} skipped, {len(rows)} candidates) at {db_path}")


if __name__ == "__main__":
    main()
