// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  decodeJwt,
  decodeProtectedHeader,
  exportPKCS8,
  generateKeyPair,
} from "jose";

vi.mock("server-only", () => ({}));

// Generate a real EC P-256 PKCS#8 private key per test. Real signing keeps
// the JWT-shape assertions honest — we don't mock jose.
async function generateP256Pkcs8Pem(): Promise<string> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return await exportPKCS8(privateKey);
}

type CapturedRequest = {
  headers: Record<string, unknown>;
  body: string;
};

type StubBehavior = {
  status: number;
  apnsId?: string;
  body?: string;
};

function buildStubConnect(captured: CapturedRequest[], behavior: StubBehavior) {
  // Stubs http2.connect (cast at call sites), which is called with an
  // authority arg this stub doesn't need — JS ignores extra call-site args
  // for a function that declares fewer params, so it's safe to drop it here.
  return function stubConnect() {
    const session = new EventEmitter() as EventEmitter & {
      request: (h: Record<string, unknown>) => unknown;
      close: () => void;
    };
    session.close = () => {};
    session.request = (headers: Record<string, unknown>) => {
      const req = new EventEmitter() as EventEmitter & {
        write: (data: string) => void;
        end: () => void;
        setEncoding: (enc: string) => void;
      };
      let body = "";
      req.write = (data: string) => {
        body += data;
      };
      req.setEncoding = () => {};
      req.end = () => {
        captured.push({ headers, body });
        // Defer to mimic real http2 async response.
        queueMicrotask(() => {
          req.emit("response", {
            ":status": behavior.status,
            "apns-id": behavior.apnsId ?? "00000000-0000-0000-0000-000000000000",
          });
          if (behavior.body) {
            req.emit("data", behavior.body);
          }
          req.emit("end");
        });
      };
      return req;
    };
    return session;
  };
}

describe("apns sender", () => {
  const original: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    "APNS_KEY_ID",
    "APNS_TEAM_ID",
    "APNS_BUNDLE_ID",
    "APNS_PRIVATE_KEY",
    "APNS_ENVIRONMENT",
  ];

  beforeEach(async () => {
    for (const k of ENV_KEYS) original[k] = process.env[k];
    process.env.APNS_KEY_ID = "ABCD123456";
    process.env.APNS_TEAM_ID = "P2U3P8B923";
    process.env.APNS_BUNDLE_ID = "com.georgenijo.coach";
    process.env.APNS_PRIVATE_KEY = await generateP256Pkcs8Pem();
    process.env.APNS_ENVIRONMENT = "production";
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("sends a 200, parses headers, returns ok:true", async () => {
    const apns = await import("./apns");
    const captured: CapturedRequest[] = [];
    apns._setHttp2ConnectForTests(
      buildStubConnect(captured, {
        status: 200,
        apnsId: "abc-id",
      }) as unknown as typeof import("node:http2").connect
    );
    apns._resetApnsCachesForTests();

    const res = await apns.sendAlertToToken(
      "f".repeat(64),
      { title: "Coach", body: "Hello" }
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.apnsId).toBe("abc-id");
    }
    expect(captured).toHaveLength(1);
    const req = captured[0];
    expect(req.headers[":method"]).toBe("POST");
    expect(req.headers[":path"]).toBe(`/3/device/${"f".repeat(64)}`);
    expect(req.headers["apns-topic"]).toBe("com.georgenijo.coach");
    expect(req.headers["apns-push-type"]).toBe("alert");
    expect(req.headers["apns-priority"]).toBe("10");
    expect(req.headers["content-type"]).toBe("application/json");
    const auth = req.headers["authorization"] as string;
    expect(auth.startsWith("bearer ")).toBe(true);

    const jwt = auth.slice("bearer ".length);
    const header = decodeProtectedHeader(jwt);
    expect(header.alg).toBe("ES256");
    expect(header.kid).toBe("ABCD123456");
    expect(header.typ).toBe("JWT");
    const claims = decodeJwt(jwt);
    expect(claims.iss).toBe("P2U3P8B923");
    expect(typeof claims.iat).toBe("number");
    expect(claims.exp).toBeUndefined();

    const body = JSON.parse(req.body) as Record<string, unknown>;
    const aps = body.aps as Record<string, unknown>;
    expect((aps.alert as Record<string, string>).title).toBe("Coach");
    expect((aps.alert as Record<string, string>).body).toBe("Hello");
    expect(aps.sound).toBe("default");
  });

  it("lowercases the device token in the path", async () => {
    const apns = await import("./apns");
    const captured: CapturedRequest[] = [];
    apns._setHttp2ConnectForTests(
      buildStubConnect(captured, { status: 200 }) as unknown as typeof import("node:http2").connect
    );
    apns._resetApnsCachesForTests();
    await apns.sendAlertToToken("ABCDEF" + "0".repeat(58), {
      title: "x",
      body: "y",
    });
    expect(captured[0].headers[":path"]).toBe(`/3/device/${("abcdef" + "0".repeat(58))}`);
  });

  it("merges custom payload fields alongside aps", async () => {
    const apns = await import("./apns");
    const captured: CapturedRequest[] = [];
    apns._setHttp2ConnectForTests(
      buildStubConnect(captured, { status: 200 }) as unknown as typeof import("node:http2").connect
    );
    apns._resetApnsCachesForTests();
    await apns.sendAlertToToken("a".repeat(64), {
      title: "t",
      body: "b",
      custom: { route: "settings/connectors" },
    });
    const body = JSON.parse(captured[0].body) as Record<string, unknown>;
    expect(body.route).toBe("settings/connectors");
    expect(body.aps).toBeDefined();
  });

  it("includes badge when provided", async () => {
    const apns = await import("./apns");
    const captured: CapturedRequest[] = [];
    apns._setHttp2ConnectForTests(
      buildStubConnect(captured, { status: 200 }) as unknown as typeof import("node:http2").connect
    );
    apns._resetApnsCachesForTests();
    await apns.sendAlertToToken("a".repeat(64), {
      title: "t",
      body: "b",
      badge: 3,
    });
    const aps = (JSON.parse(captured[0].body) as Record<string, unknown>).aps as Record<string, unknown>;
    expect(aps.badge).toBe(3);
  });

  it("returns ok:false with status+reason on 410 Unregistered", async () => {
    const apns = await import("./apns");
    const captured: CapturedRequest[] = [];
    apns._setHttp2ConnectForTests(
      buildStubConnect(captured, {
        status: 410,
        body: JSON.stringify({ reason: "Unregistered" }),
      }) as unknown as typeof import("node:http2").connect
    );
    apns._resetApnsCachesForTests();
    const res = await apns.sendAlertToToken("a".repeat(64), {
      title: "t",
      body: "b",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(410);
      expect(res.reason).toBe("Unregistered");
    }
    expect(apns.shouldRemoveTokenForReason(res)).toBe(true);
  });

  it("returns ok:false on 400 BadDeviceToken without flagging for removal", async () => {
    const apns = await import("./apns");
    const captured: CapturedRequest[] = [];
    apns._setHttp2ConnectForTests(
      buildStubConnect(captured, {
        status: 400,
        body: JSON.stringify({ reason: "BadDeviceToken" }),
      }) as unknown as typeof import("node:http2").connect
    );
    apns._resetApnsCachesForTests();
    const res = await apns.sendAlertToToken("a".repeat(64), {
      title: "t",
      body: "b",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(400);
      expect(res.reason).toBe("BadDeviceToken");
    }
    expect(apns.shouldRemoveTokenForReason(res)).toBe(false);
  });

  it("uses the production host for APNS_ENVIRONMENT=production", async () => {
    const apns = await import("./apns");
    expect(apns.apnsHostForEnvironment("production")).toBe(
      "https://api.push.apple.com"
    );
    expect(apns.apnsHostForEnvironment("development")).toBe(
      "https://api.sandbox.push.apple.com"
    );
  });

  it("loadApnsConfig throws ApnsConfigError when APNS_ENVIRONMENT is invalid", async () => {
    process.env.APNS_ENVIRONMENT = "staging";
    const apns = await import("./apns");
    expect(() => apns.loadApnsConfig()).toThrow(apns.ApnsConfigError);
  });

  it("loadApnsConfig accepts base64-encoded private key", async () => {
    const pem = await generateP256Pkcs8Pem();
    process.env.APNS_PRIVATE_KEY = Buffer.from(pem).toString("base64");
    const apns = await import("./apns");
    const cfg = apns.loadApnsConfig();
    expect(cfg.privateKeyPem.includes("BEGIN PRIVATE KEY")).toBe(true);
  });

  it("loadApnsConfig throws on garbage private key", async () => {
    process.env.APNS_PRIVATE_KEY = "definitely-not-a-key";
    const apns = await import("./apns");
    expect(() => apns.loadApnsConfig()).toThrow(apns.ApnsConfigError);
  });

  it("caches the JWT across calls within the refresh window", async () => {
    const apns = await import("./apns");
    const captured: CapturedRequest[] = [];
    apns._setHttp2ConnectForTests(
      buildStubConnect(captured, { status: 200 }) as unknown as typeof import("node:http2").connect
    );
    apns._resetApnsCachesForTests();
    await apns.sendAlertToToken("a".repeat(64), { title: "t", body: "b" });
    await apns.sendAlertToToken("a".repeat(64), { title: "t", body: "b" });
    expect(captured).toHaveLength(2);
    const auth1 = captured[0].headers["authorization"] as string;
    const auth2 = captured[1].headers["authorization"] as string;
    expect(auth1).toBe(auth2);
  });
});
