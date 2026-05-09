import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Bypass real Apple JWKS verification — we only care here about how the route
// shuttles a verified identity + tz into the DB layer.
vi.mock("@/lib/auth/apple", () => ({
  AppleAuthError: class AppleAuthError extends Error {},
  verifyAppleIdentityToken: vi.fn(async () => ({
    sub: "apple-sub-route",
    email: "route@example.com",
  })),
}));

// jose's WebCrypto sign path rejects Node Buffer instances inside jsdom. Stub
// the JWT signer entirely so the route can complete without invoking it.
vi.mock("@/lib/auth/jwt", () => ({
  signSessionToken: vi.fn(async () => ({
    token: "stub-token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  })),
}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "apple-route-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;

new Database(dbFile).close();

type RouteModule = typeof import("./route");
type ConnectionModule = typeof import("@/lib/db/connection");
let route: RouteModule;
let connection: ConnectionModule;

function readUserBySub(sub: string): { id: number; timezone: string | null } | null {
  const db = new Database(dbFile);
  try {
    const row = db
      .prepare("SELECT id, timezone FROM users WHERE apple_sub = ? LIMIT 1")
      .get(sub) as { id: number; timezone: string | null } | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

function resetUsers(): void {
  const db = new Database(dbFile);
  try {
    db.prepare("DELETE FROM users WHERE id <> 1").run();
    db.prepare("UPDATE users SET timezone = NULL, apple_sub = NULL, email = NULL WHERE id = 1").run();
  } finally {
    db.close();
  }
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/auth/apple", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  connection = await import("@/lib/db/connection");
  // Force schema bootstrap before the route runs its first upsert.
  connection.openWrite()?.close();
  route = await import("./route");
});

beforeEach(() => {
  resetUsers();
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("POST /api/auth/apple", () => {
  it("persists a valid IANA tz alongside the new user", async () => {
    const res = await route.POST(
      makeRequest({ identity_token: "fake.token.value", tz: "America/New_York" }),
    );
    expect(res.status).toBe(200);
    const row = readUserBySub("apple-sub-route");
    expect(row?.timezone).toBe("America/New_York");
  });

  it("ignores an invalid tz string but still authenticates", async () => {
    const res = await route.POST(
      makeRequest({ identity_token: "fake.token.value", tz: "Not/A/Real/Zone" }),
    );
    expect(res.status).toBe(200);
    expect(readUserBySub("apple-sub-route")?.timezone).toBeNull();
  });

  it("canonicalizes a non-canonical IANA tz to the resolved name", async () => {
    // Lowercase input must round-trip as the canonical mixed-case form so
    // downstream jobs don't see two zones for what is the same region.
    const res = await route.POST(
      makeRequest({ identity_token: "fake.token.value", tz: "america/new_york" }),
    );
    expect(res.status).toBe(200);
    expect(readUserBySub("apple-sub-route")?.timezone).toBe("America/New_York");
  });

  it("does not clobber a saved tz when a later sign-in omits the field", async () => {
    // First call writes the TZ.
    await route.POST(
      makeRequest({ identity_token: "fake.token.value", tz: "Europe/London" }),
    );
    expect(readUserBySub("apple-sub-route")?.timezone).toBe("Europe/London");

    // Second call (e.g. older client) sends no tz — saved value must survive.
    const res = await route.POST(makeRequest({ identity_token: "fake.token.value" }));
    expect(res.status).toBe(200);
    expect(readUserBySub("apple-sub-route")?.timezone).toBe("Europe/London");
  });
});
