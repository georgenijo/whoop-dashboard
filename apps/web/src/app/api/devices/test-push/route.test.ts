// @vitest-environment node
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({
    user: {
      id: 1,
      email: "test@example.com",
      name: null,
      apple_sub: "test-sub",
      timezone: null,
    },
    source: "ios" as const,
  })),
}));

// Stub the APNs sender — we're testing the route's gating + fan-out, not
// the http2 client. apns.test.ts covers the sender itself.
vi.mock("@/lib/push", () => ({
  sendAlertToToken: vi.fn(async () => ({
    ok: true,
    apnsId: "stub-apns-id",
  })),
}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "test-push-route-"));
const dbFile = path.join(tmpRoot, "test.db");
writeFileSync(dbFile, "");
process.env.WHOOP_DB_PATH = dbFile;

type RouteModule = typeof import("./route");
type ConnectionModule = typeof import("@/lib/db/connection");
type DevicesModule = typeof import("@/lib/db/devices");
let route: RouteModule;
let devices: DevicesModule;

function clearTokens(): void {
  const db = new Database(dbFile);
  try {
    db.prepare("DELETE FROM device_tokens").run();
  } finally {
    db.close();
  }
}

function makeRequest(): Request {
  return new Request("http://localhost/api/devices/test-push", {
    method: "POST",
  });
}

beforeAll(async () => {
  const connection: ConnectionModule = await import("@/lib/db/connection");
  connection.openWrite()?.close();
  route = await import("./route");
  devices = await import("@/lib/db/devices");
});

beforeEach(() => {
  clearTokens();
  delete process.env.ENABLE_PUSH_DEBUG;
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("POST /api/devices/test-push", () => {
  it("returns 404 in production without ENABLE_PUSH_DEBUG=1", async () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await route.POST(makeRequest());
      expect(res.status).toBe(404);
    } finally {
      process.env.NODE_ENV = orig;
    }
  });

  it("ENABLE_PUSH_DEBUG=1 unblocks the gate in production (auth still enforced → 401)", async () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.ENABLE_PUSH_DEBUG = "1";
    const { requireAuth } = await import("@/lib/auth");
    vi.mocked(requireAuth).mockRejectedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );
    try {
      const res = await route.POST(makeRequest());
      // The gate let us through (otherwise 404). Then requireAuth rejected
      // the unauthenticated request with 401 — exactly the wiring we want.
      expect(res.status).toBe(401);
    } finally {
      process.env.NODE_ENV = orig;
      delete process.env.ENABLE_PUSH_DEBUG;
    }
  });

  it("fans out to all tokens for the authenticated user", async () => {
    devices.upsertDeviceToken({
      user_id: 1,
      token: "a".repeat(64),
      platform: "ios",
      env: "production",
    });
    devices.upsertDeviceToken({
      user_id: 1,
      token: "b".repeat(64),
      platform: "ios",
      env: "production",
    });
    const res = await route.POST(makeRequest());
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      results: { token: string; ok: boolean; status: number }[];
    };
    expect(json.ok).toBe(true);
    expect(json.results).toHaveLength(2);
    expect(json.results.every((r) => r.ok)).toBe(true);
  });

  it("returns 404 no_tokens_registered when the user has no tokens", async () => {
    const res = await route.POST(makeRequest());
    expect(res.status).toBe(404);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.error).toBe("no_tokens_registered");
  });
});
