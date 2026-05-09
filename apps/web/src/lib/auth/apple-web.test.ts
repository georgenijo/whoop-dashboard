// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeJwt, decodeProtectedHeader, generateKeyPair, exportPKCS8 } from "jose";

vi.mock("server-only", () => ({}));

const ENV_KEYS = [
  "APPLE_TEAM_ID",
  "APPLE_SERVICES_ID",
  "APPLE_KEY_ID",
  "APPLE_PRIVATE_KEY",
] as const;

const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

async function generateP8(): Promise<string> {
  // ES256 -> P-256 EC key in PKCS#8 PEM. Apple's .p8 files are PKCS#8.
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return await exportPKCS8(privateKey);
}

beforeEach(async () => {
  for (const k of ENV_KEYS) originalEnv[k] = process.env[k];
  process.env.APPLE_TEAM_ID = "TEAM123456";
  process.env.APPLE_SERVICES_ID = "com.test.services";
  process.env.APPLE_KEY_ID = "KEYID98765";
  process.env.APPLE_PRIVATE_KEY = await generateP8();
  vi.resetModules();
  const { _resetAppleWebCacheForTests } = await import("./apple-web");
  _resetAppleWebCacheForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

describe("buildAppleClientSecret — JWT shape", () => {
  it("signs a JWT with Apple-required ES256 alg + kid header + iss/sub/aud claims", async () => {
    const { buildAppleClientSecret } = await import("./apple-web");
    const jwt = await buildAppleClientSecret();
    const header = decodeProtectedHeader(jwt);
    const claims = decodeJwt(jwt);
    expect(header.alg).toBe("ES256");
    expect(header.kid).toBe("KEYID98765");
    expect(claims.iss).toBe("TEAM123456");
    expect(claims.sub).toBe("com.test.services");
    expect(claims.aud).toBe("https://appleid.apple.com");
    expect(typeof claims.iat).toBe("number");
    expect(typeof claims.exp).toBe("number");
    // Apple caps client_secret at 6 months (15777000s). We mint at 180 days
    // (15552000s); allow a 1s tolerance for clock granularity.
    const lifetime = (claims.exp as number) - (claims.iat as number);
    expect(lifetime).toBeGreaterThan(15_551_999);
    expect(lifetime).toBeLessThan(15_777_001);
  });

  it("accepts base64-encoded PEM in APPLE_PRIVATE_KEY", async () => {
    process.env.APPLE_PRIVATE_KEY = Buffer.from(
      process.env.APPLE_PRIVATE_KEY as string,
      "utf8"
    ).toString("base64");
    vi.resetModules();
    const { _resetAppleWebCacheForTests, buildAppleClientSecret } = await import(
      "./apple-web"
    );
    _resetAppleWebCacheForTests();
    const jwt = await buildAppleClientSecret();
    expect(decodeJwt(jwt).sub).toBe("com.test.services");
  });

  it("returns the cached JWT on a second call within the freshness window", async () => {
    const { buildAppleClientSecret } = await import("./apple-web");
    const a = await buildAppleClientSecret();
    const b = await buildAppleClientSecret();
    expect(a).toBe(b);
  });

  it("re-mints when the cached JWT is for a different config", async () => {
    const { buildAppleClientSecret, _resetAppleWebCacheForTests } = await import(
      "./apple-web"
    );
    _resetAppleWebCacheForTests();
    const first = await buildAppleClientSecret({
      teamId: "AAA",
      servicesId: "svc1",
      keyId: "k1",
      privateKeyPem: process.env.APPLE_PRIVATE_KEY as string,
    });
    const second = await buildAppleClientSecret({
      teamId: "BBB",
      servicesId: "svc2",
      keyId: "k2",
      privateKeyPem: process.env.APPLE_PRIVATE_KEY as string,
    });
    expect(first).not.toBe(second);
    expect(decodeJwt(first).iss).toBe("AAA");
    expect(decodeJwt(second).iss).toBe("BBB");
    expect(decodeJwt(second).sub).toBe("svc2");
  });

  it("throws AppleWebConfigError when a required env var is missing", async () => {
    delete process.env.APPLE_TEAM_ID;
    vi.resetModules();
    const { buildAppleClientSecret, AppleWebConfigError } = await import("./apple-web");
    await expect(buildAppleClientSecret()).rejects.toBeInstanceOf(AppleWebConfigError);
  });

  it("throws AppleWebConfigError when APPLE_PRIVATE_KEY is junk", async () => {
    process.env.APPLE_PRIVATE_KEY = "not-a-pem-not-base64-of-a-pem";
    vi.resetModules();
    const { buildAppleClientSecret, AppleWebConfigError } = await import("./apple-web");
    await expect(buildAppleClientSecret()).rejects.toBeInstanceOf(AppleWebConfigError);
  });
});
