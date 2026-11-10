// @vitest-environment node
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAuth: requireAuthMock,
  clientId: () => "fixture-client",
  clientSecret: () => "fixture-secret",
}));
vi.mock("@/lib/logger", () => ({
  forModule: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const request = () => new Request("http://localhost/api/auth/whoop/disconnect", {
  method: "POST",
});

describe("POST /api/auth/whoop/disconnect", () => {
  let fixtureDir: string;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(async () => {
    vi.resetModules();
    requireAuthMock.mockReset();
    requireAuthMock.mockResolvedValue({ user: { id: 2 } });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    fixtureDir = mkdtempSync(path.join(os.tmpdir(), "whoop-disconnect-"));
    const dbPath = path.join(fixtureDir, "fixture.db");
    writeFileSync(dbPath, "");
    vi.stubEnv("WHOOP_DB_PATH", dbPath);
    vi.stubEnv("VAULT_KEY", randomBytes(32).toString("base64"));

    const { openWrite } = await import("@/lib/db/connection");
    const db = openWrite();
    if (!db) throw new Error("Fixture database unavailable");
    try {
      // User 1 is a real signed-in account here, regardless of its historical role.
      db.prepare("UPDATE users SET apple_sub = ? WHERE id = 1").run("apple-user-a");
      db.prepare("INSERT INTO users (id, email, apple_sub) VALUES (?, ?, ?)")
        .run(2, "b@example.test", "apple-user-b");
      db.prepare("INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)")
        .run(1, "fixture-session-a", "2099-01-01T00:00:00Z");
    } finally {
      db.close();
    }
    const { upsertIntegration } = await import("@/lib/db/integrations");
    for (const userId of [1, 2]) {
      upsertIntegration({
        user_id: userId,
        provider: "whoop",
        access_token: `access-${userId}`,
        refresh_token: `refresh-${userId}`,
        expires_at: "2099-01-01T00:00:00Z",
      });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("user B disconnecting leaves user A's id-1 integration intact and revokes only B's token", async () => {
    const { getIntegration, upsertIntegration } = await import("@/lib/db/integrations");
    const userABefore = getIntegration(1, "whoop");
    upsertIntegration({
      user_id: 2,
      provider: "other",
      access_token: "other-access",
      refresh_token: "other-refresh",
      expires_at: "2099-01-01T00:00:00Z",
    });
    const { POST } = await import("./route");

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(getIntegration(1, "whoop")).toEqual(userABefore);
    expect(getIntegration(2, "whoop")).toBeNull();
    expect(getIntegration(2, "other")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.prod.whoop.com/oauth/oauth2/revoke");
    expect(options?.method).toBe("POST");
    expect(options?.body?.toString()).toBe("token=refresh-2&token_type_hint=refresh_token");
  });

  it("preserves the complete settings/iOS response shape and remains idempotent", async () => {
    const { POST } = await import("./route");
    const { integrationRowExists } = await import("@/lib/db/integrations");

    const first = await POST(request());
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      ok: true,
      removed: true,
      db_removed: true,
      legacy_removed: false,
      revoked: true,
      revoke_error: null,
    });
    const second = await POST(request());
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      ok: true,
      removed: false,
      db_removed: false,
      legacy_removed: false,
      revoked: null,
      revoke_error: null,
    });
    expect(integrationRowExists(1, "whoop")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not remove user 1 even when it has no Apple identity or sessions", async () => {
    const { openWrite } = await import("@/lib/db/connection");
    const db = openWrite()!;
    try {
      db.exec("DELETE FROM sessions WHERE user_id = 1; UPDATE users SET apple_sub = NULL WHERE id = 1");
    } finally {
      db.close();
    }
    const { POST } = await import("./route");
    const { integrationRowExists } = await import("@/lib/db/integrations");

    await POST(request());

    expect(integrationRowExists(1, "whoop")).toBe(true);
    expect(integrationRowExists(2, "whoop")).toBe(false);
  });

  it("allows user 1 to disconnect its own integration without removing B's", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 1 } });
    const { POST } = await import("./route");
    const { integrationRowExists } = await import("@/lib/db/integrations");

    const response = await POST(request());

    expect(await response.json()).toMatchObject({ removed: true, legacy_removed: false });
    expect(integrationRowExists(1, "whoop")).toBe(false);
    expect(integrationRowExists(2, "whoop")).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.body?.toString()).toContain("token=refresh-1&");
  });

  it.each(["non-2xx", "network"])("keeps local deletion scoped when revocation fails (%s)", async (failure) => {
    if (failure === "network") fetchMock.mockRejectedValue(new Error("offline"));
    else fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    const { POST } = await import("./route");
    const { integrationRowExists } = await import("@/lib/db/integrations");

    const response = await POST(request());

    expect(await response.json()).toEqual({
      ok: true,
      removed: true,
      db_removed: true,
      legacy_removed: false,
      revoked: false,
      revoke_error: null,
    });
    expect(integrationRowExists(1, "whoop")).toBe(true);
    expect(integrationRowExists(2, "whoop")).toBe(false);
  });

  it("does not revoke or delete either integration when authentication fails", async () => {
    const authError = new Error("Unauthorized");
    requireAuthMock.mockRejectedValue(authError);
    const { POST } = await import("./route");
    const { integrationRowExists } = await import("@/lib/db/integrations");

    await expect(POST(request())).rejects.toBe(authError);

    expect(integrationRowExists(1, "whoop")).toBe(true);
    expect(integrationRowExists(2, "whoop")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
