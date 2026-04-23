#!/usr/bin/env python3
"""Concurrent-writer WAL smoke test for shared/whoop_data.db.

Spawns a writer thread (upserts into `signals` every 250ms) and a reader
thread (selects from recovery/cycles/signals every 100ms) against the same
SQLite DB for a configurable duration. Fails if any 'database is locked'
error is observed.

Local pre-PR check for issue #55. The full 1h container bind-mount soak
(Python writer on host + Node reader in rootful Podman) is an OptiPlex
manual step.
"""

import argparse
import os
import sqlite3
import sys
import threading
import time
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "streamlit"))

from whoop.db import DB_PATH, init_db  # noqa: E402


class Stats:
    def __init__(self):
        self.writes = 0
        self.reads = 0
        self.lock_errors = 0
        self.other_errors = 0
        self.lock = threading.Lock()

    def incr(self, field: str, n: int = 1):
        with self.lock:
            setattr(self, field, getattr(self, field) + n)


def writer_loop(stop: threading.Event, stats: Stats, interval_s: float):
    while not stop.is_set():
        try:
            conn = sqlite3.connect(DB_PATH, timeout=5.0)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute(
                "INSERT OR REPLACE INTO signals VALUES (?,?,?,?,?)",
                (
                    datetime.utcnow().strftime("%Y-%m-%d"),
                    f"wal_smoke_{threading.get_ident()}",
                    time.time(),
                    None,
                    datetime.utcnow().isoformat(),
                ),
            )
            conn.commit()
            conn.close()
            stats.incr("writes")
        except sqlite3.OperationalError as e:
            if "database is locked" in str(e):
                stats.incr("lock_errors")
            else:
                stats.incr("other_errors")
            print(f"[writer] {e}", file=sys.stderr)
        except Exception as e:
            stats.incr("other_errors")
            print(f"[writer] {e}", file=sys.stderr)
        stop.wait(interval_s)


def reader_loop(stop: threading.Event, stats: Stats, interval_s: float):
    while not stop.is_set():
        try:
            conn = sqlite3.connect(DB_PATH, timeout=5.0)
            conn.row_factory = sqlite3.Row
            for table in ("recovery", "cycles", "signals"):
                conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
            conn.close()
            stats.incr("reads")
        except sqlite3.OperationalError as e:
            if "database is locked" in str(e):
                stats.incr("lock_errors")
            else:
                stats.incr("other_errors")
            print(f"[reader] {e}", file=sys.stderr)
        except Exception as e:
            stats.incr("other_errors")
            print(f"[reader] {e}", file=sys.stderr)
        stop.wait(interval_s)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--duration", type=int, default=60, help="seconds (default 60, max 3600)")
    parser.add_argument("--write-interval", type=float, default=0.25)
    parser.add_argument("--read-interval", type=float, default=0.10)
    args = parser.parse_args()

    duration = max(1, min(args.duration, 3600))
    print(f"WAL smoke: DB_PATH={DB_PATH} duration={duration}s")

    init_db()

    stats = Stats()
    stop = threading.Event()
    t_w = threading.Thread(target=writer_loop, args=(stop, stats, args.write_interval), daemon=True)
    t_r = threading.Thread(target=reader_loop, args=(stop, stats, args.read_interval), daemon=True)
    t_w.start()
    t_r.start()

    try:
        time.sleep(duration)
    except KeyboardInterrupt:
        print("\n[main] interrupted")
    finally:
        stop.set()
        t_w.join(timeout=5)
        t_r.join(timeout=5)

    print(
        f"done: writes={stats.writes} reads={stats.reads} "
        f"lock_errors={stats.lock_errors} other_errors={stats.other_errors}"
    )
    if stats.lock_errors or stats.other_errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
