"""Whoop OAuth helpers.

Token storage:
    - Primary: encrypted `integrations` row (user_id=1, provider="whoop").
    - Parallel write to tokens.json (legacy/file-fallback) until M4 cuts over.
    - File fallback fires only when DB has NO row at all. If the row exists
      but decrypt fails, callers see None — we never silently mask corruption
      by reading tokens.json.

`expires_at` is an ISO 8601 string everywhere (e.g. "2026-05-09T18:42:11+00:00").
Consumers should treat the float-shaped legacy field as deprecated; the
migration script normalizes float -> ISO at write time.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import string
import threading
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import requests
from dotenv import load_dotenv

from whoop.integrations import (
    delete_integration,
    get_integration,
    integration_row_exists,
    upsert_integration,
)

load_dotenv()

log = logging.getLogger(__name__)

AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
SCOPES = "offline read:profile read:recovery read:cycles read:sleep read:workout read:body_measurement"
TOKEN_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "tokens.json")

WHOOP_PROVIDER = "whoop"
DEFAULT_USER_ID = 1
REFRESH_BUFFER_S = 60

_refresh_lock = threading.Lock()


def _generate_state() -> str:
    chars = string.ascii_letters + string.digits
    return "".join(secrets.choice(chars) for _ in range(8))


def build_auth_url(client_id: str, redirect_uri: str) -> str:
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPES,
        "state": _generate_state(),
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def _expires_at_iso(expires_in: float | int) -> str:
    """Compute ISO 8601 expires_at from Whoop's `expires_in` (seconds)."""
    return (
        datetime.now(timezone.utc) + timedelta(seconds=float(expires_in))
    ).isoformat()


def exchange_code(code: str, redirect_uri: str) -> dict:
    client_id = os.getenv("WHOOP_CLIENT_ID")
    client_secret = os.getenv("WHOOP_CLIENT_SECRET")
    resp = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "client_secret": client_secret,
        },
    )
    resp.raise_for_status()
    token_data = resp.json()
    token_data["expires_at"] = _expires_at_iso(token_data.get("expires_in", 3600))
    save_tokens(token_data)
    return token_data


def load_tokens() -> dict | None:
    """Return the current Whoop tokens, or None.

    Lookup order:
        1. integrations DB row (encrypted). If decrypt fails, return None and
           DO NOT fall back to file — that would mask corruption.
        2. tokens.json (only when no DB row exists at all).

    Returns dict with at minimum `access_token`, `refresh_token`,
    `expires_at` (ISO 8601 string).
    """
    integration = get_integration(DEFAULT_USER_ID, WHOOP_PROVIDER)
    if integration is not None:
        # Spread `raw` first so freshly-decrypted fields win on conflict —
        # guards against stale `raw` after a partial column update.
        # Public API key is `scope` (singular).
        return {
            **(integration.get("raw") or {}),
            "access_token": integration["access_token"],
            "refresh_token": integration["refresh_token"],
            "expires_at": integration["expires_at"],
            "scope": integration["scope"],
            "token_type": integration["token_type"],
        }

    if integration_row_exists(DEFAULT_USER_ID, WHOOP_PROVIDER):
        # Row exists but decryption failed. Don't fall back to file —
        # silently masking corruption is worse than a hard fail upstream.
        log.warning(
            "[auth] integrations row present but undecryptable; refusing file fallback"
        )
        return None

    # No DB row at all → use tokens.json (first-run / pre-migration).
    try:
        with open(TOKEN_FILE) as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        return None
    if "access_token" not in data or "refresh_token" not in data:
        return None
    # Normalize legacy float `expires_at` to ISO 8601 in-memory (the on-disk
    # file is left alone here — migration script will convert + persist).
    expires_at = data.get("expires_at")
    if isinstance(expires_at, (int, float)):
        data["expires_at"] = (
            datetime.fromtimestamp(float(expires_at), tz=timezone.utc).isoformat()
        )
    return data


def save_tokens(data: dict) -> None:
    """Persist tokens to encrypted DB and parallel-write to tokens.json.

    The `raw` column on `integrations` is UNENCRYPTED JSON — so we MUST NOT
    pass the full token dict into it. That would defeat the vault by storing
    plaintext credentials alongside the ciphertext. Today nothing non-secret
    needs to live in `raw`, so we always pass `raw=None`. If a future caller
    needs to persist metadata, gate it through a tight allowlist or its own
    encrypted column.

    Writes are independent: a failure to update `tokens.json` does not abort
    the DB write, and vice versa — but we log loudly. If BOTH writes fail we
    raise so the caller doesn't continue assuming the tokens are saved. Per
    spec we NEVER delete tokens.json from this layer.
    """
    expires_at = data.get("expires_at")
    if isinstance(expires_at, (int, float)):
        expires_at_iso = datetime.fromtimestamp(
            float(expires_at), tz=timezone.utc
        ).isoformat()
    elif isinstance(expires_at, str):
        # Validate by parsing — raises if malformed.
        datetime.fromisoformat(expires_at)
        expires_at_iso = expires_at
    else:
        raise TypeError(
            f"save_tokens: expires_at must be ISO str or numeric epoch, got "
            f"{type(expires_at).__name__}"
        )
    # Store ISO form back so the file write below also gets the canonical shape.
    data = dict(data)
    data["expires_at"] = expires_at_iso

    db_ok = False
    file_ok = False
    db_err: Exception | None = None
    file_err: Exception | None = None

    # 1) Encrypted DB write. raw=None — see docstring above.
    try:
        upsert_integration(
            DEFAULT_USER_ID,
            WHOOP_PROVIDER,
            access_token=data["access_token"],
            refresh_token=data["refresh_token"],
            expires_at=expires_at_iso,
            scope=data.get("scope") or data.get("scopes"),
            token_type=data.get("token_type"),
            raw=None,
        )
        db_ok = True
    except Exception as exc:  # noqa: BLE001
        db_err = exc
        log.error("[auth] integrations upsert failed: %s", exc)

    # 2) Parallel write to tokens.json (atomic tmp + rename).
    try:
        tmp = TOKEN_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, TOKEN_FILE)
        file_ok = True
    except OSError as exc:
        file_err = exc
        log.error("[auth] tokens.json write failed: %s", exc)

    if not db_ok and not file_ok:
        raise RuntimeError(
            f"save_tokens: both writes failed "
            f"(db: {db_err!s}; file: {file_err!s})"
        )


def is_expired(data: dict) -> bool:
    """True if tokens are within REFRESH_BUFFER_S seconds of expiry."""
    expires_at = data.get("expires_at")
    if isinstance(expires_at, str):
        # Pre-3.11, datetime.fromisoformat rejects the trailing-Z form. We
        # control writes (no Z), but be defensive against external sources
        # (e.g. a Whoop response leaking through, or a hand-edited file).
        normalized = expires_at[:-1] + "+00:00" if expires_at.endswith("Z") else expires_at
        try:
            exp_dt = datetime.fromisoformat(normalized)
        except ValueError:
            return True
    elif isinstance(expires_at, (int, float)):
        # Defensive fallback for any caller still passing a legacy float.
        exp_dt = datetime.fromtimestamp(float(expires_at), tz=timezone.utc)
    else:
        return True
    if exp_dt.tzinfo is None:
        exp_dt = exp_dt.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) > exp_dt - timedelta(seconds=REFRESH_BUFFER_S)


def refresh_tokens(data: dict) -> dict | None:
    """Refresh the access token using the stored refresh_token.

    Returns the new token dict on success. On failure:
        - `invalid_grant` (refresh token revoked / expired) → clear_tokens()
          and return None. The user must re-auth.
        - any other error (5xx, timeout, network) → log + return None. The
          tokens stay put so the next call can retry.
    """
    client_id = os.getenv("WHOOP_CLIENT_ID")
    client_secret = os.getenv("WHOOP_CLIENT_SECRET")
    try:
        resp = requests.post(
            TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": data["refresh_token"],
                "client_id": client_id,
                "client_secret": client_secret,
            },
        )
    except requests.exceptions.RequestException as exc:
        # Network-level failure: timeout, DNS, connection reset, etc. Do NOT
        # clear tokens — this is transient.
        log.warning("[auth] refresh_tokens network error: %s", exc)
        return None

    if resp.ok:
        token_data = resp.json()
        token_data["expires_at"] = _expires_at_iso(token_data.get("expires_in", 3600))
        save_tokens(token_data)
        return token_data

    # Non-2xx. Only clear tokens on a real `invalid_grant` (HTTP 400/401 with
    # error=invalid_grant in the JSON body). Everything else (5xx, transient
    # 401s, rate limits) → log + return None and let the caller retry.
    is_invalid_grant = False
    if resp.status_code in (400, 401):
        try:
            body = resp.json()
            if isinstance(body, dict) and body.get("error") == "invalid_grant":
                is_invalid_grant = True
        except ValueError:
            # Non-JSON body — treat as transient, not invalid_grant.
            pass

    if is_invalid_grant:
        log.info(
            "[auth] refresh_tokens got invalid_grant (status=%s); clearing",
            resp.status_code,
        )
        clear_tokens()
        return None

    log.warning(
        "[auth] refresh_tokens transient error (status=%s); leaving tokens in place",
        resp.status_code,
    )
    return None


def clear_tokens() -> None:
    """Disconnect: drop the integrations row AND blank `tokens.json` to `{}`.

    Per spec we NEVER `os.unlink` tokens.json — the file is the recovery
    anchor. But pre-vault, `clear_tokens` deleted both the DB row AND the
    file, so re-auth was forced. Post-vault, if we only dropped the DB row,
    the file fallback in `load_tokens` would silently re-authenticate the
    user who just clicked Disconnect. That is both a UX regression and a
    security surprise.

    Fix: truncate the file body to an empty JSON object. The file still
    exists on disk (preserving the "recoverable file" invariant), but
    `load_tokens` returns None because the required keys are absent.
    """
    try:
        delete_integration(DEFAULT_USER_ID, WHOOP_PROVIDER)
    except Exception as exc:  # noqa: BLE001
        log.error("[auth] integrations delete failed: %s", exc)

    # Atomic tmp + rename so we never leave a half-written file behind.
    try:
        tmp = TOKEN_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump({}, f)
        os.replace(tmp, TOKEN_FILE)
    except OSError as exc:
        log.error("[auth] tokens.json blank-out failed: %s", exc)


def get_valid_token() -> str | None:
    with _refresh_lock:
        data = load_tokens()
        if data is None:
            return None
        if is_expired(data):
            data = refresh_tokens(data)
            if data is None:
                return None
        return data["access_token"]
