#!/usr/bin/env python3
"""Daily cron job: fetch Whoop data, sync to SQLite, generate AI insight."""

import concurrent.futures
import json
import os
import sys
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

sys.path.insert(0, REPO_ROOT)
sys.path.insert(0, os.path.join(REPO_ROOT, "streamlit"))

from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(REPO_ROOT, ".env"))

from sync.daily_summary import compute_daily_summary
from whoop.auth import get_valid_token
from whoop.client import WhoopClient
from whoop.db import DB_PATH, init_db, sync_all
from whoop.insights import generate_insight


def _parse_record_date(record: dict, field: str) -> str | None:
    value = record.get(field)
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).strftime("%Y-%m-%d")


def _synced_dates(data: dict) -> list[str]:
    dates: set[str] = set()
    for endpoint, field, require_scored in (
        ("recovery", "created_at", True),
        ("cycles", "start", True),
        ("sleep", "start", True),
        ("workouts", "start", False),
    ):
        for record in data.get(endpoint, []):
            if require_scored and record.get("score_state") != "SCORED":
                continue
            date = _parse_record_date(record, field)
            if date is not None:
                dates.add(date)
    return sorted(dates)


def _elapsed_ms(start: float) -> int:
    return int(round((time.perf_counter() - start) * 1000))


def _get_all_with_page_count(
    client: WhoopClient, endpoint: str, params: dict | None = None
) -> tuple[list, int]:
    params = dict(params or {})
    params["limit"] = 25
    records = []
    next_token = None
    page_count = 0

    while True:
        if next_token:
            params["nextToken"] = next_token
        elif "nextToken" in params:
            del params["nextToken"]

        data = client._get(endpoint, params)
        page_count += 1
        records.extend(data.get("records", []))
        next_token = data.get("next_token")
        if not next_token:
            break

    return records, page_count


def _timed_fetch(
    name: str,
    fetcher,
) -> tuple[str, list | dict, int, int]:
    started = time.perf_counter()
    result, page_count = fetcher()
    return name, result, _elapsed_ms(started), page_count


def _fetch_all_parallel_with_timings(
    access_token: str, start: str, end: str
) -> tuple[dict[str, list | dict], dict[str, int], dict[str, int]]:
    client = WhoopClient(access_token)
    fetchers = {
        "profile": lambda: (client.get_profile(), 1),
        "body": lambda: (client.get_body_measurement(), 1),
        "cycles": lambda: (
            _get_all_with_page_count(client, "/v2/cycle", {"start": start, "end": end})
        ),
        "recovery": lambda: (
            _get_all_with_page_count(client, "/v2/recovery", {"start": start, "end": end})
        ),
        "sleep": lambda: (
            _get_all_with_page_count(
                client, "/v2/activity/sleep", {"start": start, "end": end}
            )
        ),
        "workouts": lambda: (
            _get_all_with_page_count(
                client, "/v2/activity/workout", {"start": start, "end": end}
            )
        ),
    }

    results = {}
    fetch_breakdown = {}
    page_counts = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        futures = {
            pool.submit(_timed_fetch, name, fetcher): name
            for name, fetcher in fetchers.items()
        }
        for future in concurrent.futures.as_completed(futures):
            name, result, duration_ms, page_count = future.result()
            results[name] = result
            fetch_breakdown[name] = duration_ms
            page_counts[name] = page_count

    return results, fetch_breakdown, page_counts


def main():
    init_db()

    token = get_valid_token()
    if not token:
        print("ERROR: No valid token. Re-auth required via dashboard.")
        sys.exit(1)

    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    end = now.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    details = {"window_days": 7}
    counts = {"recovery": None, "sleep": None, "workouts": None}

    try:
        print(f"Fetching data from {start} to {end}...")
        fetch_started = time.perf_counter()
        try:
            data, fetch_breakdown, page_counts = _fetch_all_parallel_with_timings(
                token, start, end
            )
        finally:
            details["fetch_ms"] = _elapsed_ms(fetch_started)
        details["fetch_breakdown"] = fetch_breakdown
        details["page_counts"] = page_counts

        sync_started = time.perf_counter()
        try:
            sync_all(data)
        finally:
            details["sync_db_ms"] = _elapsed_ms(sync_started)

        counts = {
            "recovery": len(data.get("recovery", [])),
            "sleep": len(data.get("sleep", [])),
            "workouts": len(data.get("workouts", [])),
        }
        print(f"Synced: {len(data.get('recovery', []))} recovery, "
              f"{len(data.get('sleep', []))} sleep, "
              f"{len(data.get('workouts', []))} workouts")

        summary_started = time.perf_counter()
        try:
            summary_count = compute_daily_summary(DB_PATH, _synced_dates(data))
        finally:
            details["summary_ms"] = _elapsed_ms(summary_started)
        print(f"Computed daily_summary for {summary_count} dates")

        print("Generating AI insight...")
        insight_started = time.perf_counter()
        try:
            insight = generate_insight(30)
        finally:
            details["insight_ms"] = _elapsed_ms(insight_started)
        print(f"Insight saved ({len(insight)} chars)")
    finally:
        print(json.dumps({"counts": counts, "details": details}, sort_keys=True))


if __name__ == "__main__":
    main()
