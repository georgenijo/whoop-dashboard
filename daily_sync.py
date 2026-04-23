#!/usr/bin/env python3
"""Daily cron job: fetch Whoop data, sync to SQLite, generate AI insight."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "streamlit"))

from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from whoop.auth import get_valid_token
from whoop.client import fetch_all_parallel
from whoop.db import init_db, sync_all
from whoop.insights import generate_insight


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

    print("Generating AI insight...")
    insight = generate_insight(30)
    print(f"Insight saved ({len(insight)} chars)")


if __name__ == "__main__":
    main()
