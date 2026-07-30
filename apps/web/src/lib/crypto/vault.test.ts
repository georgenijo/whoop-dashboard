// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CURRENT_KEY_VERSION,
  VaultDecryptError,
  VaultMissingKeyError,
  assertKeyVersionSupported,
  decryptBytes,
  encryptBytes,
} from "./vault";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

beforeEach(() => {
  process.env.VAULT_KEY = TEST_KEY;
});
describe("binary vault", () => {
  it("round-trips arbitrary bytes without storing plaintext", () => {
    const plaintext = Buffer.from([0, 1, 2, 255, 42, 0, 99]);
    const ciphertext = encryptBytes(plaintext);

    expect(ciphertext.equals(plaintext)).toBe(false);
    expect(decryptBytes(ciphertext)).toEqual(plaintext);
  });

  it("rejects tampered ciphertext", () => {
    const ciphertext = encryptBytes(Buffer.from("private image bytes"));
    ciphertext[ciphertext.length - 1] ^= 0xff;

    expect(() => decryptBytes(ciphertext)).toThrow(VaultDecryptError);
  });

  it("fails closed when the key is missing or invalid", () => {
    delete process.env.VAULT_KEY;
    expect(() => encryptBytes(Buffer.from("x"))).toThrow(VaultMissingKeyError);

    process.env.VAULT_KEY = "not-a-32-byte-key";
    expect(() => encryptBytes(Buffer.from("x"))).toThrow(VaultMissingKeyError);
  });

  it("rejects unsupported key versions", () => {
    expect(() => assertKeyVersionSupported(CURRENT_KEY_VERSION + 1)).toThrow(
      VaultDecryptError,
    );
  });
});
