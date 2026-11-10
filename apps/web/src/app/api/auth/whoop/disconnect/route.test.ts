// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

// Auth is mocked at the route boundary so each test can act as a specific
// signed-in user without minting a real SIWA session. Everything below it
// (integrations, users, sessions, app_settings) is the real DB layer against
// a temp SQLite file.
const requireAuthMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAuth: (req: Request) => requireAuthMock(req),
  clientId: () => "test-client-id",
  clientSecret: () => "test-client-secret",
}));

function freshDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-disconnect-"));
  const p = path.join(dir, "whoop_data.db");
  // openWrite() requires the file to exist (existsSync gate). Touch it.
  fs.writeFileSync(p, "");
  return p;
}

describe("POST /api/auth/whoop/disconnect — authorization boundary", () => {
  let dbPath: string;
  let originalKey: string | undefined;
  let originalDbPath: string | undefined;
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

  beforeEach(() => {
    originalKey = process.env.VAULT_KEY;
    originalDbPath = process.env.WHOOP_DB_PATH;
    dbPath = freshDbPath();
    process.env.VAULT_KEY = crypto.randomBytes(32).toString("base64");
    process.env.WHOOP_DB_PATH = dbPath;
    vi.resetModules();
    requireAuthMock.mockReset();
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.VAULT_KEY;
    else process.env.VAULT_KEY = originalKey;
    if (originalDbPath === undefined) delete process.env.WHOOP_DB_PATH;
    else process.env.WHOOP_DB_PATH = originalDbPath;
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  async function loadModules() {
    const conn = await import("@/lib/db/connection");
    // Open + close once so the schema (incl. users/sessions/app_settings) is
    // created before the test seeds rows.
    const db = conn.openWrite();
    expect(db).not.toBeNull();
    db?.close();
    const integrations = await import("@/lib/db/integrations");
    const settings = await import("@/lib/db/settings");
    const route = await import("./route");
    return { conn, integrations, settings, POST: route.POST };
  }

  function seedUser(
    conn: Awaited<ReturnType<typeof loadModules>>["conn"],
    id: number,
    appleSub: string | null
  ): void {
    const db = conn.openWrite();
    expect(db).not.toBeNull();
    try {
      // connection.openWrite() bootstraps id=1 as the legacy placeholder, so
      // upsert rather than insert.
      db!
        .prepare(
          `INSERT INTO users (id, apple_sub, email) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             apple_sub = excluded.apple_sub,
             email = excluded.email`
        )
        .run(id, appleSub, `${id}@example.com`);
    } finally {
      db?.close();
    }
  }

  function seedSession(
    conn: Awaited<ReturnType<typeof loadModules>>["conn"],
    userId: number
  ): void {
    const db = conn.openWrite();
    expect(db).not.toBeNull();
    try {
      db!
        .prepare(
          "INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)"
        )
        .run(userId, crypto.randomUUID(), "2099-01-01T00:00:00.000Z");
    } finally {
      db?.close();
    }
  }

  function seedWhoopIntegration(
    integrations: Awaited<ReturnType<typeof loadModules>>["integrations"],
    userId: number
  ): void {
    integrations.upsertIntegration({
      user_id: userId,
      provider: "whoop",
      access_token: `access-${userId}`,
      refresh_token: `refresh-${userId}`,
      expires_at: "2099-01-01T00:00:00+00:00",
    });
  }

  function actAs(userId: number): void {
    requireAuthMock.mockResolvedValue({
      user: {
        id: userId,
        apple_sub: `apple-${userId}`,
        email: `${userId}@example.com`,
        name: null,
        timezone: null,
      },
      source: "web",
    });
  }

  function disconnect(): Promise<Response> {
    return import("./route").then(({ POST }) =>
      POST(
        new Request("http://localhost/api/auth/whoop/disconnect", {
          method: "POST",
        })
      )
    );
  }

  it("user B disconnecting leaves user A's (id 1) integration intact", async () => {
    const { conn, integrations } = await loadModules();
    // User 1 is a real account here (Apple identity), so it must be untouched.
    seedUser(conn, 1, "apple-a");
    seedUser(conn, 2, "apple-b");
    seedWhoopIntegration(integrations, 1);
    seedWhoopIntegration(integrations, 2);
    actAs(2);

    const res = await disconnect();

    expect(res.status).toBe(200);
    expect(integrations.getIntegration(2, "whoop")).toBeNull();
    expect(integrations.getIntegration(1, "whoop")).not.toBeNull();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.legacy_removed).toBe(false);
  });

  it("keeps the response shape consumed by Settings and iOS", async () => {
    const { conn, integrations } = await loadModules();
    seedUser(conn, 1, "apple-a");
    seedUser(conn, 2, "apple-b");
    seedWhoopIntegration(integrations, 2);
    actAs(2);

    const res = await disconnect();
    const body = (await res.json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(
      [
        "db_removed",
        "legacy_removed",
        "ok",
        "removed",
        "revoke_error",
        "revoked",
      ].sort()
    );
    expect(body).toMatchObject({
      ok: true,
      removed: true,
      db_removed: true,
      legacy_removed: false,
      revoked: true,
      revoke_error: null,
    });
  });

  it("cleans up the retired uid=1 placeholder once, then never again", async () => {
    const { conn, integrations, settings } = await loadModules();
    // Placeholder: no Apple identity, no sessions — cannot be a real account.
    seedUser(conn, 1, null);
    seedUser(conn, 2, "apple-b");
    seedWhoopIntegration(integrations, 1);
    seedWhoopIntegration(integrations, 2);
    actAs(2);

    const first = await disconnect();
    expect(first.status).toBe(200);
    expect(integrations.getIntegration(1, "whoop")).toBeNull();
    expect(integrations.getIntegration(2, "whoop")).toBeNull();
    expect((await first.json()).legacy_removed).toBe(true);

    // Re-create the stripped row to prove the marker blocks a second delete.
    seedWhoopIntegration(integrations, 1);
    const second = await disconnect();
    expect(integrations.getIntegration(1, "whoop")).not.toBeNull();
    expect((await second.json()).legacy_removed).toBe(false);
    expect(
      settings.getSetting("legacy_uid1_whoop_integration_cleanup_v1")
    ).toBe("done");
  });

  it("never cleans uid=1 while it still has a session", async () => {
    const { conn, integrations } = await loadModules();
    seedUser(conn, 1, null);
    seedUser(conn, 2, "apple-b");
    seedSession(conn, 1);
    seedWhoopIntegration(integrations, 1);
    seedWhoopIntegration(integrations, 2);
    actAs(2);

    const res = await disconnect();

    expect(integrations.getIntegration(1, "whoop")).not.toBeNull();
    expect((await res.json()).legacy_removed).toBe(false);
  });

  it("a signed-in user only ever deletes their own row", async () => {
    const { conn, integrations } = await loadModules();
    seedUser(conn, 1, "apple-a");
    seedUser(conn, 2, "apple-b");
    seedWhoopIntegration(integrations, 1);
    seedWhoopIntegration(integrations, 2);
    actAs(1);

    const res = await disconnect();

    expect(res.status).toBe(200);
    expect(integrations.getIntegration(1, "whoop")).toBeNull();
    expect(integrations.getIntegration(2, "whoop")).not.toBeNull();
  });
});
