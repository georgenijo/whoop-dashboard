import "server-only";
import nacl from "tweetnacl";

// Symmetric authenticated encryption — NaCl secretbox (XSalsa20-Poly1305).
// Keep wire-format identical to streamlit/whoop/vault.py so the same DB row
// can be decrypted from either Node or Python.
//
// Wire format (base64-encoded over the entire blob):
//   bytes[0..24]  = 24-byte random nonce
//   bytes[24..]   = secretbox ciphertext (plaintext + 16-byte Poly1305 tag)
//
// VAULT_KEY env var: base64-encoded 32-byte key. Generate with:
//   openssl rand -base64 32

export const KEY_BYTES = 32;
export const NONCE_BYTES = 24;
export const CURRENT_KEY_VERSION = 1;

export class VaultMissingKeyError extends Error {
  constructor(message = "VAULT_KEY environment variable is not set") {
    super(message);
    this.name = "VaultMissingKeyError";
  }
}

export class VaultDecryptError extends Error {
  constructor(message = "Vault decryption failed") {
    super(message);
    this.name = "VaultDecryptError";
  }
}

// tweetnacl strict-checks `instanceof Uint8Array`. `Buffer` is a subclass on
// Node but jsdom's globals can confuse the check; wrap every byte buffer
// passing into nacl.* with `new Uint8Array(...)` to be safe.

function bufToBytes(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function loadKey(): Uint8Array {
  const raw = process.env.VAULT_KEY;
  if (!raw) throw new VaultMissingKeyError();
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    throw new VaultMissingKeyError("VAULT_KEY is not valid base64");
  }
  if (buf.length !== KEY_BYTES) {
    throw new VaultMissingKeyError(
      `VAULT_KEY must decode to ${KEY_BYTES} bytes (got ${buf.length})`
    );
  }
  return new Uint8Array(bufToBytes(buf));
}

export function encryptBytes(plaintext: Uint8Array): Buffer {
  const key = loadKey();
  const nonce = new Uint8Array(nacl.randomBytes(NONCE_BYTES));
  const message = new Uint8Array(plaintext);
  const sealed = nacl.secretbox(message, nonce, key);
  const out = new Uint8Array(nonce.length + sealed.length);
  out.set(nonce, 0);
  out.set(sealed, nonce.length);
  return Buffer.from(out);
}

export function decryptBytes(ciphertext: Uint8Array): Buffer {
  const key = loadKey();
  const blob = Buffer.from(ciphertext);
  if (blob.length < NONCE_BYTES + nacl.secretbox.overheadLength) {
    throw new VaultDecryptError("ciphertext too short");
  }
  const nonce = new Uint8Array(bufToBytes(blob).subarray(0, NONCE_BYTES));
  const sealed = new Uint8Array(bufToBytes(blob).subarray(NONCE_BYTES));
  const opened = nacl.secretbox.open(sealed, nonce, key);
  if (opened === null) throw new VaultDecryptError();
  return Buffer.from(opened);
}

export function encrypt(plaintext: string): string {
  return encryptBytes(new TextEncoder().encode(plaintext)).toString("base64");
}

export function decrypt(b64: string): string {
  let blob: Buffer;
  try {
    blob = Buffer.from(b64, "base64");
  } catch {
    throw new VaultDecryptError("ciphertext is not valid base64");
  }
  return new TextDecoder().decode(decryptBytes(blob));
}

/**
 * Verify the row's `key_version` matches a key we know how to decrypt with.
 * Until rotation lands we only know v1; anything else is a hard fail to
 * surface forward-incompatible rows clearly.
 */
export function assertKeyVersionSupported(version: number): void {
  if (version !== CURRENT_KEY_VERSION) {
    throw new VaultDecryptError(
      `unknown key_version=${version} (only ${CURRENT_KEY_VERSION} is supported)`
    );
  }
}

/**
 * Startup-time check: VAULT_KEY is present, valid base64, and the right
 * length. Throws VaultMissingKeyError with a clear message if not. Callers
 * that want to fail fast (rather than at first encrypt/decrypt) can invoke
 * this from a route boot path or admin healthcheck.
 *
 * Synchronous because key loading is synchronous (no init step); kept as a
 * thin alias to make intent obvious at call sites.
 */
export function assertVaultKeyConfigured(): void {
  loadKey();
}
