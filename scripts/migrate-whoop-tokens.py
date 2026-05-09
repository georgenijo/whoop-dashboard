#!/usr/bin/env python3
"""Migrate Whoop tokens from tokens.json (and/or legacy `tokens` table) into
the encrypted `integrations` table.

Behavior:
    - Reads from tokens.json (override with --tokens-path).
    - Normalizes float `expires_at` (legacy) to ISO 8601 UTC string.
    - Accepts both `scope` and `scopes` keys on input.
    - Bootstraps users(id=1) if missing (matches openWrite pattern).
    - Encrypts via vault, INSERT-or-UPDATE the integrations row, then
      reads the row back via get_integration and asserts plaintext matches.
      If round-trip fails, ROLLS BACK and exits 1.
    - --drop-legacy: when set AND migration succeeds AND the round-trip
      verifies, runs `DROP TABLE IF EXISTS tokens`. SAFETY: only run after
      `daily_sync.py` has confirmed encrypted reads work end-to-end.

Never deletes tokens.json. Never touches anything outside the DB and the DB
ALTER/DROP listed above.

Examples:
    VAULT_KEY=$(openssl rand -base64 32) python3 scripts/migrate-whoop-tokens.py
    VAULT_KEY=$(...) python3 scripts/migrate-whoop-tokens.py \\
        --tokens-path /tmp/test-tokens.json \\
        --db-path /tmp/integrations-test.db
    VAULT_KEY=$(...) python3 scripts/migrate-whoop-tokens.py --drop-legacy
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "streamlit"))

# IMPORTANT: do NOT import whoop.integrations / whoop.db at top level. They
# read WHOOP_DB_PATH at module import time, and we want callers to be able
# to point us at a custom DB via --db-path. The argparse step below sets the
# env var, then the imports happen lazily inside main().

DEFAULT_USER_ID = 1
WHOOP_PROVIDER = "whoop"


def _normalize_expires_at(value) -> str:
    """Accept ISO 8601 string OR float epoch seconds, return ISO 8601 UTC."""
    if isinstance(value, str):
        # Validate by parsing; raise if malformed.
        datetime.fromisoformat(value)
        return value
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
    raise ValueError(
        f"expires_at must be ISO string or numeric epoch, got "
        f"{type(value).__name__}"
    )


def _read_tokens_file(path: Path) -> dict:
    with path.open() as f:
        data = json.load(f)
    for key in ("access_token", "refresh_token"):
        if key not in data:
            raise ValueError(f"tokens file missing required field: {key}")
    if "expires_at" not in data:
        raise ValueError("tokens file missing required field: expires_at")
    data["expires_at"] = _normalize_expires_at(data["expires_at"])
    # Accept both `scope` and `scopes`; normalize to `scope`.
    if "scope" not in data and "scopes" in data:
        data["scope"] = data.pop("scopes")
    return data


def _read_legacy_tokens_row(db_path: Path) -> dict | None:
    """Pull from the legacy `tokens` table if tokens.json is unavailable."""
    if not db_path.exists():
        return None
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        master = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tokens'"
        ).fetchone()
        if not master:
            return None
        row = conn.execute(
            "SELECT * FROM tokens WHERE provider = ?", (WHOOP_PROVIDER,)
        ).fetchone()
        if row is None:
            return None
        data = json.loads(row["raw"]) if row["raw"] else {}
        data.update(
            {
                "access_token": row["access_token"],
                "refresh_token": row["refresh_token"],
                "expires_at": _normalize_expires_at(row["expires_at"]),
            }
        )
        if row["scope"] is not None:
            data["scope"] = row["scope"]
        if row["token_type"] is not None:
            data["token_type"] = row["token_type"]
        return data
    finally:
        conn.close()


def _bootstrap_user_one(db_path: Path) -> None:
    """Ensure users(id=1) exists. Matches the bootstrap pattern in
    apps/web/src/lib/db/connection.ts (`INSERT OR IGNORE INTO users (id) VALUES (1)`)."""
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                apple_sub TEXT UNIQUE,
                email TEXT,
                name TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        conn.execute("INSERT OR IGNORE INTO users (id) VALUES (1)")
        conn.commit()
    finally:
        conn.close()


def _drop_legacy_tokens(db_path: Path) -> None:
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("DROP TABLE IF EXISTS tokens")
        conn.commit()
    finally:
        conn.close()


def _delete_integration_row(db_path: Path) -> None:
    """Used as a manual rollback when the round-trip self-check fails."""
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            "DELETE FROM integrations WHERE user_id = ? AND provider = ?",
            (DEFAULT_USER_ID, WHOOP_PROVIDER),
        )
        conn.commit()
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tokens-path",
        default=str(REPO_ROOT / "tokens.json"),
        help="Path to source tokens.json (default: <repo>/tokens.json)",
    )
    parser.add_argument(
        "--db-path",
        default=os.environ.get("WHOOP_DB_PATH")
        or str(REPO_ROOT / "shared" / "whoop_data.db"),
        help="Path to whoop_data.db",
    )
    parser.add_argument(
        "--drop-legacy",
        action="store_true",
        help="DROP TABLE tokens after migration round-trip succeeds.",
    )
    parser.add_argument(
        "--from-legacy-table",
        action="store_true",
        help="Fall back to reading from the legacy `tokens` table if the "
        "tokens file is missing.",
    )
    args = parser.parse_args()

    # Steer Whoop integration helpers at the same DB. The helpers cache
    # DB_PATH at import time, so this MUST happen before the lazy import
    # below.
    os.environ["WHOOP_DB_PATH"] = args.db_path

    if not os.environ.get("VAULT_KEY"):
        print(
            "ERROR: VAULT_KEY is not set. Generate one with "
            "`openssl rand -base64 32` and export it before running.",
            file=sys.stderr,
        )
        return 1

    # Lazy import — must happen after the env var is set above.
    # Drop any pre-cached whoop.* modules so we re-pick the env.
    for mod in [m for m in list(sys.modules) if m == "whoop" or m.startswith("whoop.")]:
        del sys.modules[mod]
    from whoop.integrations import get_integration, upsert_integration
    from whoop.vault import VaultMissingKeyError

    tokens_path = Path(args.tokens_path)
    db_path = Path(args.db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    # 1) Load source tokens.
    source: dict | None = None
    if tokens_path.exists():
        try:
            source = _read_tokens_file(tokens_path)
            print(f"[migrate] read tokens from {tokens_path}")
        except (json.JSONDecodeError, ValueError) as exc:
            print(f"ERROR: failed to read {tokens_path}: {exc}", file=sys.stderr)
            return 1
    elif args.from_legacy_table:
        source = _read_legacy_tokens_row(db_path)
        if source is not None:
            print(f"[migrate] read tokens from legacy `tokens` row in {db_path}")

    if source is None:
        print(
            f"ERROR: no source tokens found "
            f"(file={tokens_path}, legacy_table={args.from_legacy_table})",
            file=sys.stderr,
        )
        return 1

    # 2) Bootstrap users(id=1) so the FK doesn't trip.
    _bootstrap_user_one(db_path)

    # 3) Encrypt + INSERT.
    # NOTE: raw=None on purpose. The `raw` column is UNENCRYPTED JSON, so
    # passing the source dict (which contains plaintext access_token /
    # refresh_token) would defeat the vault. The migration script's only job
    # is to move credentials into the encrypted columns — nothing else.
    try:
        upsert_integration(
            DEFAULT_USER_ID,
            WHOOP_PROVIDER,
            access_token=source["access_token"],
            refresh_token=source["refresh_token"],
            expires_at=source["expires_at"],
            scope=source.get("scope"),
            token_type=source.get("token_type"),
            raw=None,
        )
    except VaultMissingKeyError as exc:
        print(f"ERROR: VAULT_KEY problem: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"ERROR: upsert failed: {exc}", file=sys.stderr)
        return 1

    # 4) Self-validate: read back and assert plaintext matches.
    rt = get_integration(DEFAULT_USER_ID, WHOOP_PROVIDER)
    if rt is None:
        print(
            "ERROR: round-trip read returned None — encryption may be "
            "broken or VAULT_KEY changed mid-run. Rolling back row.",
            file=sys.stderr,
        )
        _delete_integration_row(db_path)
        return 1
    mismatches = []
    if rt["access_token"] != source["access_token"]:
        mismatches.append("access_token")
    if rt["refresh_token"] != source["refresh_token"]:
        mismatches.append("refresh_token")
    if rt["expires_at"] != source["expires_at"]:
        mismatches.append(
            f"expires_at (db={rt['expires_at']!r}, src={source['expires_at']!r})"
        )
    if mismatches:
        print(
            f"ERROR: round-trip mismatch on: {', '.join(mismatches)}. "
            f"Rolling back row.",
            file=sys.stderr,
        )
        _delete_integration_row(db_path)
        return 1

    # 4b) Defense-in-depth: assert the on-disk `raw` column IS NULL. This
    # locks the invariant that we never persist plaintext credentials in the
    # unencrypted column.
    raw_check_conn = sqlite3.connect(str(db_path))
    try:
        on_disk_raw = raw_check_conn.execute(
            "SELECT raw FROM integrations WHERE user_id = ? AND provider = ?",
            (DEFAULT_USER_ID, WHOOP_PROVIDER),
        ).fetchone()
    finally:
        raw_check_conn.close()
    if on_disk_raw is None or on_disk_raw[0] is not None:
        print(
            "ERROR: on-disk `raw` column is not NULL — refusing to persist "
            "plaintext credentials in the unencrypted column. Rolling back row.",
            file=sys.stderr,
        )
        _delete_integration_row(db_path)
        return 1

    print(
        f"[migrate] OK: integrations row written + verified "
        f"(user_id={DEFAULT_USER_ID}, provider={WHOOP_PROVIDER}, "
        f"key_version={rt['key_version']}, expires_at={rt['expires_at']})"
    )

    # 5) Optional: drop legacy `tokens` table.
    if args.drop_legacy:
        _drop_legacy_tokens(db_path)
        print("[migrate] dropped legacy `tokens` table")

    return 0


if __name__ == "__main__":
    sys.exit(main())
