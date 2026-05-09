"""Encrypted credentials storage for OAuth providers.

Convention:
    - DB column for OAuth scopes is named `scopes` (plural).
    - Public API key on the integration object is `scope` (singular), to
      match Whoop OAuth + the legacy tokens.json shape.
    - `expires_at` is always an ISO 8601 string (e.g.
      "2026-05-09T18:42:11+00:00"). Floats are not accepted at this layer.
    - `key_version` is a small int that pairs the row with the key used to
      encrypt it. v1 is the only supported version today.

Mirrors apps/web/src/lib/db/integrations.ts. Both layers can read the same row.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
from typing import Any, Optional

from whoop.db import get_conn
from whoop.vault import (
    CURRENT_KEY_VERSION,
    VaultDecryptError,
    VaultMissingKeyError,
    assert_key_version_supported,
    decrypt,
    encrypt,
)

log = logging.getLogger(__name__)


class IntegrationUserMissingError(RuntimeError):
    """user_id has no users(id) row — caller must bootstrap before integrating."""

    def __init__(self, user_id: int):
        super().__init__(
            f"user_id={user_id} not found in users table; bootstrap user first"
        )
        self.user_id = user_id


def _ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS integrations (
            user_id INTEGER NOT NULL REFERENCES users(id),
            provider TEXT NOT NULL,
            access_token TEXT NOT NULL,
            refresh_token TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            scopes TEXT,
            token_type TEXT,
            raw TEXT,
            key_version INTEGER NOT NULL DEFAULT 1,
            needs_reauth INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, provider)
        )
        """
    )
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(integrations)")}
    if cols and "key_version" not in cols:
        conn.execute(
            "ALTER TABLE integrations ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1"
        )
    if cols and "needs_reauth" not in cols:
        # `needs_reauth` is owned by the Next.js refreshTokens path
        # (apps/web/src/lib/whoop/token.ts). The flag is set on a definitive
        # 4xx from Whoop's token endpoint and reset on any successful
        # upsertIntegration. This Python column declaration exists for schema
        # parity only — Python writers here don't touch the flag, so a
        # concurrent Python refresh / sync can race against the TS-side
        # set/reset. Acceptable today; P2 keepalive will reshape this.
        conn.execute(
            "ALTER TABLE integrations ADD COLUMN needs_reauth INTEGER NOT NULL DEFAULT 0"
        )


def _ensure_users_table(conn: sqlite3.Connection) -> None:
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


def _user_exists(conn: sqlite3.Connection, user_id: int) -> bool:
    row = conn.execute(
        "SELECT 1 AS one FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    return row is not None


def _pick_scope(data: dict) -> Optional[str]:
    if "scope" in data:
        return data["scope"]
    if "scopes" in data:
        return data["scopes"]
    return None


def upsert_integration(
    user_id: int,
    provider: str,
    *,
    access_token: str,
    refresh_token: str,
    expires_at: str,
    scope: Optional[str] = None,
    scopes: Optional[str] = None,
    token_type: Optional[str] = None,
    raw: Optional[dict] = None,
) -> None:
    """Insert or update an integration row.

    Raises:
        VaultMissingKeyError: if VAULT_KEY is unset/invalid.
        IntegrationUserMissingError: if `user_id` has no users(id) row.
    """
    if not isinstance(expires_at, str):
        raise TypeError(
            f"expires_at must be ISO 8601 str, got {type(expires_at).__name__}"
        )
    conn = get_conn()
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        _ensure_users_table(conn)
        _ensure_table(conn)
        if not _user_exists(conn, user_id):
            raise IntegrationUserMissingError(user_id)
        access_ct = encrypt(access_token)
        refresh_ct = encrypt(refresh_token)
        scope_value = scope if scope is not None else scopes
        raw_json = None if raw is None else json.dumps(raw)
        conn.execute(
            """
            INSERT INTO integrations (
                user_id, provider, access_token, refresh_token, expires_at,
                scopes, token_type, raw, key_version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, provider) DO UPDATE SET
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                expires_at = excluded.expires_at,
                scopes = excluded.scopes,
                token_type = excluded.token_type,
                raw = excluded.raw,
                key_version = excluded.key_version,
                updated_at = excluded.updated_at
            """,
            (
                user_id,
                provider,
                access_ct,
                refresh_ct,
                expires_at,
                scope_value,
                token_type,
                raw_json,
                CURRENT_KEY_VERSION,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def integration_row_exists(user_id: int, provider: str) -> bool:
    """True iff a row exists. Does NOT decrypt — useful for distinguishing
    'no row' from 'row exists but decrypt failed'."""
    conn = get_conn()
    try:
        # If table missing, no row exists.
        master = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='integrations'"
        ).fetchone()
        if not master:
            return False
        row = conn.execute(
            "SELECT 1 AS one FROM integrations WHERE user_id = ? AND provider = ?",
            (user_id, provider),
        ).fetchone()
        return row is not None
    finally:
        conn.close()


def get_integration(user_id: int, provider: str) -> Optional[dict[str, Any]]:
    """Returns decrypted integration dict, or None if:
        - the row does not exist
        - VAULT_KEY is unset or wrong key
        - the row's key_version is not supported
        - decryption fails (e.g. tampered ciphertext)

    Decrypt errors are logged at error-level and swallowed. To distinguish
    'no row' from 'row but unreadable', pair with `integration_row_exists`.
    """
    conn = get_conn()
    try:
        master = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='integrations'"
        ).fetchone()
        if not master:
            return None
        row = conn.execute(
            """
            SELECT user_id, provider, access_token, refresh_token, expires_at,
                   scopes, token_type, raw, key_version, updated_at
            FROM integrations
            WHERE user_id = ? AND provider = ?
            """,
            (user_id, provider),
        ).fetchone()
        if row is None:
            return None
        try:
            assert_key_version_supported(row["key_version"])
            access = decrypt(row["access_token"])
            refresh = decrypt(row["refresh_token"])
        except (VaultDecryptError, VaultMissingKeyError) as exc:
            log.error(
                "[integrations] decrypt failed for user_id=%s provider=%s: %s",
                user_id,
                provider,
                exc,
            )
            return None
        try:
            raw = json.loads(row["raw"]) if row["raw"] else None
        except (json.JSONDecodeError, TypeError):
            raw = None
        return {
            "user_id": row["user_id"],
            "provider": row["provider"],
            "access_token": access,
            "refresh_token": refresh,
            "expires_at": row["expires_at"],
            "scope": row["scopes"],  # public API: scope (singular)
            "token_type": row["token_type"],
            "raw": raw,
            "key_version": row["key_version"],
            "updated_at": row["updated_at"],
        }
    finally:
        conn.close()


def delete_integration(user_id: int, provider: str) -> None:
    conn = get_conn()
    try:
        conn.execute(
            "DELETE FROM integrations WHERE user_id = ? AND provider = ?",
            (user_id, provider),
        )
        conn.commit()
    finally:
        conn.close()
