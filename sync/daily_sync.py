#!/usr/bin/env python3
"""Daily cron job: fetch Whoop data, sync to SQLite, generate AI insight."""

import sys
import os

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

sys.path.insert(0, REPO_ROOT)
sys.path.insert(0, os.path.join(REPO_ROOT, "streamlit"))

from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(REPO_ROOT, ".env"))

from sync.daily_summary import compute_daily_summary
from whoop.auth import get_valid_token
from whoop.client import fetch_all_parallel
from whoop.db import DB_PATH, init_db, sync_all
from whoop.insights import generate_insight


def _parse_record_date(record: dict, field: str) -> str | None:
    value = record.get(field)
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).strftime("%Y-%m-%d")


def _synced_dates(data: dict) -> list[str]:
    dates: set[str] = set()
    for endpoint, field in (
        ("recovery", "created_at"),
        ("cycles", "start"),
        ("sleep", "start"),
        ("workouts", "start"),
    ):
        for record in data.get(endpoint, []):
            if record.get("score_state") != "SCORED":
                continue
            date = _parse_record_date(record, field)
            if date is not None:
                dates.add(date)
    return sorted(dates)


def main():
    init_db()

    token = get_valid_token()
    if not token:
        print("ERROR: No valid token. Re-auth required via dashboard.")
        sys.exit(1)

    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    end = now.strftime("%Y-%m-%dT%H:%M:%S.000Z")

    print(f"Fetching data from {start} to {end}...")
    data = fetch_all_parallel(token, start, end)
    sync_all(data)
    print(f"Synced: {len(data.get('recovery', []))} recovery, "
          f"{len(data.get('sleep', []))} sleep, "
          f"{len(data.get('workouts', []))} workouts")
    summary_count = compute_daily_summary(DB_PATH, _synced_dates(data))
    print(f"Computed daily_summary for {summary_count} dates")

    print("Generating AI insight...")
    insight = generate_insight(30)
    print(f"Insight saved ({len(insight)} chars)")


if __name__ == "__main__":
    main()
