// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey } from "jose";

vi.mock("server-only", () => ({}));

// We don't want jose's `createRemoteJWKSet` to ever hit the network. Replace
// it with a function that returns a static key resolver pointing at the test
// key pair generated in `beforeEach`. Each test creates a fresh key pair, so
// `_resetAppleJWKSCacheForTests` between tests is what re-runs this hook.
const testKeys: { privateKey: CryptoKey | null; publicKey: CryptoKey | null; kid: string } = {
  privateKey: null,
  publicKey: null,
  kid: "test-kid",
};

vi.mock("jose", async () => {
  const actual = await vi.importActual<typeof import("jose")>("jose");
  return {
    ...actual,
    createRemoteJWKSet: () => async () => {
      if (!testKeys.publicKey) throw new Error("test key not initialised");
      return testKeys.publicKey;
    },
  };
});

const APPLE_BUNDLE_ID = "com.test.bundle";
const APPLE_SERVICES_ID = "com.test.services";

const ORIGINAL_BUNDLE_ID = process.env.APPLE_BUNDLE_ID;

beforeEach(async () => {
  process.env.APPLE_BUNDLE_ID = APPLE_BUNDLE_ID;
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  testKeys.privateKey = privateKey as CryptoKey;
  testKeys.publicKey = publicKey as CryptoKey;
  // Mint a kid based on the public JWK so each test pair is uniquely tagged.
  const jwk = await exportJWK(publicKey);
  testKeys.kid = `kid-${jwk.n?.slice(0, 8) ?? "x"}`;
  // Drop our module-level cache; the mock returns the SAME publicKey resolver
  // either way, but resetting matches production behaviour.
  const { _resetAppleJWKSCacheForTests } = await import("./apple");
  _resetAppleJWKSCacheForTests();
});

afterEach(() => {
  if (ORIGINAL_BUNDLE_ID === undefined) delete process.env.APPLE_BUNDLE_ID;
  else process.env.APPLE_BUNDLE_ID = ORIGINAL_BUNDLE_ID;
});

async function mintToken(audience: string, opts: { sub?: string; email?: string } = {}): Promise<string> {
  if (!testKeys.privateKey) throw new Error("test key not initialised");
  const sub = opts.sub ?? "001234.abc";
  return new SignJWT({ ...(opts.email ? { email: opts.email } : {}) })
    .setProtectedHeader({ alg: "RS256", kid: testKeys.kid })
    .setSubject(sub)
    .setIssuer("https://appleid.apple.com")
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(testKeys.privateKey);
}

describe("verifyAppleIdentityToken — audience", () => {
  it("accepts the iOS bundle id when no opts.audience is passed", async () => {
    const { verifyAppleIdentityToken } = await import("./apple");
    const token = await mintToken(APPLE_BUNDLE_ID, { email: "user@privaterelay.appleid.com" });
    const id = await verifyAppleIdentityToken(token);
    expect(id.sub).toBe("001234.abc");
    expect(id.email).toBe("user@privaterelay.appleid.com");
  });

  it("rejects an unrelated audience when default behaviour applies", async () => {
    const { verifyAppleIdentityToken, AppleAuthError } = await import("./apple");
    const token = await mintToken("com.somebody.else");
    await expect(verifyAppleIdentityToken(token)).rejects.toBeInstanceOf(AppleAuthError);
  });

  it("accepts the Services ID when passed via opts.audience", async () => {
    const { verifyAppleIdentityToken } = await import("./apple");
    const token = await mintToken(APPLE_SERVICES_ID);
    const id = await verifyAppleIdentityToken(token, { audience: APPLE_SERVICES_ID });
    expect(id.sub).toBe("001234.abc");
  });

  it("accepts EITHER audience when an array is passed", async () => {
    const { verifyAppleIdentityToken } = await import("./apple");
    const both = [APPLE_BUNDLE_ID, APPLE_SERVICES_ID];
    const bundleToken = await mintToken(APPLE_BUNDLE_ID);
    const servicesToken = await mintToken(APPLE_SERVICES_ID);
    expect((await verifyAppleIdentityToken(bundleToken, { audience: both })).sub).toBe("001234.abc");
    expect((await verifyAppleIdentityToken(servicesToken, { audience: both })).sub).toBe("001234.abc");
  });

  it("rejects when neither array element matches", async () => {
    const { verifyAppleIdentityToken, AppleAuthError } = await import("./apple");
    const token = await mintToken("com.unknown");
    await expect(
      verifyAppleIdentityToken(token, { audience: [APPLE_BUNDLE_ID, APPLE_SERVICES_ID] })
    ).rejects.toBeInstanceOf(AppleAuthError);
  });

  it("does not require APPLE_BUNDLE_ID env when explicit audience is passed", async () => {
    delete process.env.APPLE_BUNDLE_ID;
    const { verifyAppleIdentityToken } = await import("./apple");
    const token = await mintToken(APPLE_SERVICES_ID);
    const id = await verifyAppleIdentityToken(token, { audience: APPLE_SERVICES_ID });
    expect(id.sub).toBe("001234.abc");
  });
});
