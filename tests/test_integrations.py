"""Mirrors apps/web/src/lib/db/integrations.test.ts.

Encrypt/decrypt round-trip, ON CONFLICT update, get_integration null on
tampered ciphertext / wrong key / unsupported key_version, FK error on
missing user_id.
"""

from __future__ import annotations

import base64
import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "streamlit"))


def _fresh_db() -> str:
    fd, path = tempfile.mkstemp(prefix="vault-itest-", suffix=".db")
    os.close(fd)
    # Empty file is fine — sqlite will populate.
    return path


def _bootstrap_user_one(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
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


@pytest.fixture
def env(monkeypatch):
    """Per-test isolated DB + VAULT_KEY. Reloads the integration modules so
    they re-pick the WHOOP_DB_PATH env var."""
    db_path = _fresh_db()
    key = base64.b64encode(os.urandom(32)).decode("ascii")
    monkeypatch.setenv("VAULT_KEY", key)
    monkeypatch.setenv("WHOOP_DB_PATH", db_path)

    # Force reimport so the module-level DB_PATH constant in whoop.db picks
    # up our env var on every test. Drop ALL `whoop.*` to avoid stale bindings.
    for mod in [m for m in list(sys.modules) if m == "whoop" or m.startswith("whoop.")]:
        del sys.modules[mod]

    _bootstrap_user_one(db_path)

    import importlib
    integrations = importlib.import_module("whoop.integrations")
    vault = importlib.import_module("whoop.vault")

    yield {
        "db_path": db_path,
        "integrations": integrations,
        "vault": vault,
    }

    try:
        Path(db_path).unlink()
    except FileNotFoundError:
        pass


def test_round_trip_encrypts_on_insert_decrypts_on_read(env):
    integrations = env["integrations"]
    integrations.upsert_integration(
        1,
        "whoop",
        access_token="access-abc",
        refresh_token="refresh-xyz",
        expires_at="2026-05-09T18:42:11+00:00",
        scope="offline read:profile",
        token_type="bearer",
        raw={"ext": "value"},
    )
    got = integrations.get_integration(1, "whoop")
    assert got is not None
    assert got["access_token"] == "access-abc"
    assert got["refresh_token"] == "refresh-xyz"
    assert got["scope"] == "offline read:profile"
    assert got["token_type"] == "bearer"
    assert got["expires_at"] == "2026-05-09T18:42:11+00:00"
    assert got["key_version"] == 1
    assert got["raw"] == {"ext": "value"}


def test_on_conflict_update_overwrites_in_place(env):
    integrations = env["integrations"]
    integrations.upsert_integration(
        1,
        "whoop",
        access_token="v1",
        refresh_token="r1",
        expires_at="2026-05-09T00:00:00+00:00",
    )
    integrations.upsert_integration(
        1,
        "whoop",
        access_token="v2",
        refresh_token="r2",
        expires_at="2026-05-10T00:00:00+00:00",
    )
    got = integrations.get_integration(1, "whoop")
    assert got["access_token"] == "v2"
    assert got["refresh_token"] == "r2"
    assert got["expires_at"] == "2026-05-10T00:00:00+00:00"


def test_get_integration_returns_none_on_tampered_ciphertext(env):
    integrations = env["integrations"]
    integrations.upsert_integration(
        1,
        "whoop",
        access_token="access-abc",
        refresh_token="refresh-xyz",
        expires_at="2026-05-09T18:42:11+00:00",
    )
    # Corrupt the access_token directly.
    conn = sqlite3.connect(env["db_path"])
    try:
        conn.execute(
            "UPDATE integrations SET access_token = ? WHERE user_id = ? AND provider = ?",
            ("not-real-but-tampered", 1, "whoop"),
        )
        conn.commit()
    finally:
        conn.close()
    assert integrations.get_integration(1, "whoop") is None
    # ...but integration_row_exists still says yes.
    assert integrations.integration_row_exists(1, "whoop") is True


def test_get_integration_returns_none_when_vault_key_missing(env, monkeypatch):
    integrations = env["integrations"]
    integrations.upsert_integration(
        1,
        "whoop",
        access_token="a",
        refresh_token="r",
        expires_at="2026-05-09T00:00:00+00:00",
    )
    monkeypatch.delenv("VAULT_KEY", raising=False)
    assert integrations.get_integration(1, "whoop") is None


def test_get_integration_returns_none_when_key_version_unsupported(env):
    integrations = env["integrations"]
    integrations.upsert_integration(
        1,
        "whoop",
        access_token="a",
        refresh_token="r",
        expires_at="2026-05-09T00:00:00+00:00",
    )
    conn = sqlite3.connect(env["db_path"])
    try:
        conn.execute(
            "UPDATE integrations SET key_version = 99 WHERE user_id = ?",
            (1,),
        )
        conn.commit()
    finally:
        conn.close()
    assert integrations.get_integration(1, "whoop") is None
    assert integrations.integration_row_exists(1, "whoop") is True


def test_upsert_raises_for_missing_user_id(env):
    integrations = env["integrations"]
    with pytest.raises(integrations.IntegrationUserMissingError):
        integrations.upsert_integration(
            9999,
            "whoop",
            access_token="a",
            refresh_token="r",
            expires_at="2026-05-09T00:00:00+00:00",
        )


def test_accepts_both_scope_and_scopes_reads_back_as_scope(env):
    integrations = env["integrations"]
    integrations.upsert_integration(
        1,
        "whoop",
        access_token="a",
        refresh_token="r",
        expires_at="2026-05-09T00:00:00+00:00",
        scopes="offline read:recovery",
    )
    got = integrations.get_integration(1, "whoop")
    assert got["scope"] == "offline read:recovery"


def test_vault_encrypt_decrypt_symmetry(env):
    vault = env["vault"]
    blob = vault.encrypt("hello world")
    assert isinstance(blob, str)
    assert vault.decrypt(blob) == "hello world"


def test_vault_decrypt_raises_on_tampered_blob(env):
    vault = env["vault"]
    blob = vault.encrypt("hello")
    raw = base64.b64decode(blob)
    raw = raw[:-1] + bytes([raw[-1] ^ 0xFF])
    tampered = base64.b64encode(raw).decode("ascii")
    with pytest.raises(vault.VaultDecryptError):
        vault.decrypt(tampered)


def test_vault_encrypt_raises_when_vault_key_unset(env, monkeypatch):
    vault = env["vault"]
    monkeypatch.delenv("VAULT_KEY", raising=False)
    with pytest.raises(vault.VaultMissingKeyError):
        vault.encrypt("x")


def test_delete_integration_idempotent(env):
    integrations = env["integrations"]
    integrations.upsert_integration(
        1,
        "whoop",
        access_token="a",
        refresh_token="r",
        expires_at="2026-05-09T00:00:00+00:00",
    )
    assert integrations.integration_row_exists(1, "whoop") is True
    integrations.delete_integration(1, "whoop")
    assert integrations.integration_row_exists(1, "whoop") is False
    integrations.delete_integration(1, "whoop")  # no-op


def test_expires_at_must_be_string(env):
    integrations = env["integrations"]
    with pytest.raises(TypeError):
        integrations.upsert_integration(
            1,
            "whoop",
            access_token="a",
            refresh_token="r",
            expires_at=1234567890.0,  # legacy float — must be rejected here
        )


# ---------- BLOCK 1+2: on-disk `raw` must NOT contain plaintext credentials.

def test_save_tokens_writes_null_raw_on_disk(env, tmp_path, monkeypatch):
    """Lock the security invariant: after save_tokens, the on-disk `raw`
    column for the integrations row MUST be NULL (or empty).

    `raw` is unencrypted JSON; storing the full token dict there would defeat
    the vault. This test reads the row directly via SQL (not via
    get_integration, which would decrypt) and asserts:
        - `raw` is NULL on disk
        - the encrypted columns do NOT contain the plaintext token strings
    """
    # Point save_tokens at an isolated tokens.json so we don't touch the repo's.
    fake_tokens = tmp_path / "tokens.json"
    monkeypatch.setattr("whoop.auth.TOKEN_FILE", str(fake_tokens))

    auth = pytest.importorskip("whoop.auth")
    auth.save_tokens(
        {
            "access_token": "PLAINTEXT-ACCESS-SHOULD-NEVER-LAND-IN-RAW",
            "refresh_token": "PLAINTEXT-REFRESH-SHOULD-NEVER-LAND-IN-RAW",
            "expires_at": "2026-05-09T18:42:11+00:00",
            "scope": "offline read:profile",
            "token_type": "bearer",
            "expires_in": 3600,
        }
    )

    conn = sqlite3.connect(env["db_path"])
    try:
        row = conn.execute(
            "SELECT access_token, refresh_token, raw FROM integrations "
            "WHERE user_id = ? AND provider = ?",
            (1, "whoop"),
        ).fetchone()
    finally:
        conn.close()
    assert row is not None, "save_tokens should have written a row"
    access_ct, refresh_ct, raw_on_disk = row

    # Hard invariant: `raw` must be NULL on disk.
    assert raw_on_disk is None, (
        f"on-disk raw must be NULL post-vault, got: {raw_on_disk!r}"
    )

    # Defense-in-depth: confirm the encrypted columns are actually encrypted
    # (don't contain the plaintext substrings).
    assert "PLAINTEXT-ACCESS" not in (access_ct or "")
    assert "PLAINTEXT-REFRESH" not in (refresh_ct or "")


# ---------- BLOCK 3: clear_tokens must preserve tokens.json (file stays).

def test_clear_tokens_preserves_tokens_json_and_drops_db_row(env, tmp_path, monkeypatch):
    """Per spec, tokens.json is the recovery anchor — it must NEVER be
    deleted from disk. clear_tokens may blank it to {} but the file stays.

    This test:
        1. Writes a synthetic tokens.json
        2. Calls save_tokens to populate the integrations row
        3. Calls clear_tokens
        4. Asserts: file still exists, DB row is gone, file contents no
           longer round-trip to a usable token via load_tokens (so we don't
           silently re-auth — see BLOCK 4).
    """
    fake_tokens = tmp_path / "tokens.json"
    monkeypatch.setattr("whoop.auth.TOKEN_FILE", str(fake_tokens))

    auth = pytest.importorskip("whoop.auth")
    auth.save_tokens(
        {
            "access_token": "a",
            "refresh_token": "r",
            "expires_at": "2026-05-09T18:42:11+00:00",
            "scope": "offline",
            "token_type": "bearer",
            "expires_in": 3600,
        }
    )
    assert fake_tokens.exists()
    integrations = env["integrations"]
    assert integrations.integration_row_exists(1, "whoop") is True

    auth.clear_tokens()

    # File still on disk (recovery-anchor invariant).
    assert fake_tokens.exists(), "clear_tokens must NEVER delete tokens.json"

    # DB row is gone.
    assert integrations.integration_row_exists(1, "whoop") is False
    assert integrations.get_integration(1, "whoop") is None


def test_clear_tokens_prevents_silent_reauth_via_file_fallback(env, tmp_path, monkeypatch):
    """BLOCK 4: post-vault, if clear_tokens only dropped the DB row, the
    file fallback in load_tokens would silently re-authenticate the user
    who just clicked Disconnect. Lock the fix: load_tokens returns None
    even though tokens.json still exists on disk."""
    fake_tokens = tmp_path / "tokens.json"
    monkeypatch.setattr("whoop.auth.TOKEN_FILE", str(fake_tokens))

    auth = pytest.importorskip("whoop.auth")
    auth.save_tokens(
        {
            "access_token": "a",
            "refresh_token": "r",
            "expires_at": "2026-05-09T18:42:11+00:00",
            "expires_in": 3600,
        }
    )
    assert auth.load_tokens() is not None  # sanity: tokens are reachable

    auth.clear_tokens()

    assert fake_tokens.exists()
    assert auth.load_tokens() is None, (
        "after clear_tokens, load_tokens must NOT silently re-authenticate "
        "via the file fallback"
    )


# ---------- WARN: is_expired must accept the trailing-Z form defensively.

def test_is_expired_accepts_trailing_z(env):
    """Pre-3.11 datetime.fromisoformat rejects 'Z'. We control writes so 'Z'
    shouldn't appear, but be defensive against external sources (Whoop API
    leak, hand-edit). The Z form must parse, not silently mark expired."""
    auth = pytest.importorskip("whoop.auth")
    # An expiry well into the future, with Z suffix.
    future_z = "2099-01-01T00:00:00Z"
    assert auth.is_expired({"expires_at": future_z}) is False
    # And an expiry in the past (with Z) → expired.
    past_z = "2000-01-01T00:00:00Z"
    assert auth.is_expired({"expires_at": past_z}) is True


def test_is_expired_rejects_garbage(env):
    auth = pytest.importorskip("whoop.auth")
    assert auth.is_expired({"expires_at": "not-a-date"}) is True
    assert auth.is_expired({}) is True


# ---------- WARN: refresh_tokens must scope clear_tokens to invalid_grant only.

def test_refresh_tokens_clears_only_on_invalid_grant(env, tmp_path, monkeypatch):
    """Transient errors (5xx, network) must NOT clear tokens. Only a real
    invalid_grant (refresh token revoked) should force a re-auth."""
    import requests as _requests

    fake_tokens = tmp_path / "tokens.json"
    monkeypatch.setattr("whoop.auth.TOKEN_FILE", str(fake_tokens))

    auth = pytest.importorskip("whoop.auth")
    auth.save_tokens(
        {
            "access_token": "a",
            "refresh_token": "r",
            "expires_at": "2026-05-09T18:42:11+00:00",
            "expires_in": 3600,
        }
    )
    integrations = env["integrations"]
    assert integrations.integration_row_exists(1, "whoop") is True

    class _FakeResp:
        def __init__(self, status_code: int, body: object):
            self.status_code = status_code
            self.ok = 200 <= status_code < 300
            self._body = body

        def json(self):
            if isinstance(self._body, Exception):
                raise self._body
            return self._body

    # Case A: 503 transient — must NOT clear.
    monkeypatch.setattr(
        _requests, "post", lambda *a, **kw: _FakeResp(503, {"error": "down"})
    )
    out = auth.refresh_tokens({"refresh_token": "r"})
    assert out is None
    assert integrations.integration_row_exists(1, "whoop") is True, (
        "503 must NOT clear tokens"
    )

    # Case B: 401 with non-invalid_grant body — must NOT clear.
    monkeypatch.setattr(
        _requests, "post", lambda *a, **kw: _FakeResp(401, {"error": "rate_limited"})
    )
    out = auth.refresh_tokens({"refresh_token": "r"})
    assert out is None
    assert integrations.integration_row_exists(1, "whoop") is True, (
        "401 without invalid_grant must NOT clear tokens"
    )

    # Case C: network error — must NOT clear.
    def _boom(*a, **kw):
        raise _requests.exceptions.ConnectionError("simulated")

    monkeypatch.setattr(_requests, "post", _boom)
    out = auth.refresh_tokens({"refresh_token": "r"})
    assert out is None
    assert integrations.integration_row_exists(1, "whoop") is True, (
        "network error must NOT clear tokens"
    )

    # Case D: 400 with invalid_grant — MUST clear.
    monkeypatch.setattr(
        _requests, "post", lambda *a, **kw: _FakeResp(400, {"error": "invalid_grant"})
    )
    out = auth.refresh_tokens({"refresh_token": "r"})
    assert out is None
    assert integrations.integration_row_exists(1, "whoop") is False, (
        "invalid_grant MUST clear tokens"
    )


# ---------- WARN: save_tokens raises if BOTH writes fail.

def test_save_tokens_raises_when_both_writes_fail(env, tmp_path, monkeypatch):
    """If both the DB upsert AND the tokens.json write fail, save_tokens
    must NOT silently swallow — the caller would proceed assuming a save."""
    # Point at an unwritable directory for tokens.json.
    bad_path = tmp_path / "nope" / "tokens.json"  # parent doesn't exist
    monkeypatch.setattr("whoop.auth.TOKEN_FILE", str(bad_path))
    # Force the DB write to fail too. Easiest: make upsert_integration raise.
    auth = pytest.importorskip("whoop.auth")

    def _fail(*a, **kw):
        raise RuntimeError("simulated db failure")

    monkeypatch.setattr("whoop.auth.upsert_integration", _fail)

    with pytest.raises(RuntimeError, match="both writes failed"):
        auth.save_tokens(
            {
                "access_token": "a",
                "refresh_token": "r",
                "expires_at": "2026-05-09T18:42:11+00:00",
                "expires_in": 3600,
            }
        )


def test_save_tokens_succeeds_when_only_file_fails(env, tmp_path, monkeypatch):
    """If the DB write succeeds but the file write fails, save_tokens must
    NOT raise — we still have one persistent copy."""
    bad_path = tmp_path / "nope" / "tokens.json"  # parent doesn't exist
    monkeypatch.setattr("whoop.auth.TOKEN_FILE", str(bad_path))

    auth = pytest.importorskip("whoop.auth")
    # Should not raise.
    auth.save_tokens(
        {
            "access_token": "a",
            "refresh_token": "r",
            "expires_at": "2026-05-09T18:42:11+00:00",
            "expires_in": 3600,
        }
    )
    assert env["integrations"].integration_row_exists(1, "whoop") is True
