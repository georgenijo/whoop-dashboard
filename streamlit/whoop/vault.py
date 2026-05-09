"""Symmetric authenticated encryption for OAuth credentials.

Uses libsodium (via PyNaCl) `SecretBox` — XSalsa20-Poly1305. Wire-format
identical to apps/web/src/lib/crypto/vault.ts so Node and Python can read
each other's rows.

Wire format (base64-encoded over the entire blob):
    bytes[0..24]  = 24-byte random nonce
    bytes[24..]   = secretbox ciphertext (plaintext + 16-byte Poly1305 tag)

VAULT_KEY env var: base64-encoded 32-byte key. Generate with:
    openssl rand -base64 32
"""

from __future__ import annotations

import base64
import binascii
import os

from nacl.exceptions import CryptoError
from nacl.secret import SecretBox
from nacl.utils import random as nacl_random

KEY_BYTES = 32
NONCE_BYTES = 24
CURRENT_KEY_VERSION = 1


class VaultMissingKeyError(RuntimeError):
    """VAULT_KEY env var is unset, malformed, or wrong length."""


class VaultDecryptError(RuntimeError):
    """Ciphertext could not be decrypted (wrong key, tampered, malformed)."""


def _load_key() -> bytes:
    raw = os.environ.get("VAULT_KEY")
    if not raw:
        raise VaultMissingKeyError("VAULT_KEY environment variable is not set")
    try:
        key = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise VaultMissingKeyError("VAULT_KEY is not valid base64") from exc
    if len(key) != KEY_BYTES:
        raise VaultMissingKeyError(
            f"VAULT_KEY must decode to {KEY_BYTES} bytes (got {len(key)})"
        )
    return key


def encrypt(plaintext: str) -> str:
    """Encrypt `plaintext` and return base64(nonce || ciphertext)."""
    key = _load_key()
    box = SecretBox(key)
    nonce = nacl_random(NONCE_BYTES)
    ct = box.encrypt(plaintext.encode("utf-8"), nonce).ciphertext
    blob = nonce + ct
    return base64.b64encode(blob).decode("ascii")


def decrypt(b64: str) -> str:
    """Decrypt the wire format produced by `encrypt`."""
    key = _load_key()
    try:
        blob = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise VaultDecryptError("ciphertext is not valid base64") from exc
    # SecretBox.MACBYTES == 16
    if len(blob) < NONCE_BYTES + SecretBox.MACBYTES:
        raise VaultDecryptError("ciphertext too short")
    nonce, ct = blob[:NONCE_BYTES], blob[NONCE_BYTES:]
    box = SecretBox(key)
    try:
        return box.decrypt(ct, nonce).decode("utf-8")
    except CryptoError as exc:
        raise VaultDecryptError("Vault decryption failed") from exc


def assert_key_version_supported(version: int) -> None:
    """Hard-fail if the row was encrypted with a key we don't have.

    Until rotation lands we only know v1; anything else is a forward-incompatible
    row and we want a clear error rather than silent fall-through.
    """
    if version != CURRENT_KEY_VERSION:
        raise VaultDecryptError(
            f"unknown key_version={version} (only {CURRENT_KEY_VERSION} is supported)"
        )
