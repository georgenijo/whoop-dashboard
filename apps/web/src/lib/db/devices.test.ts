import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

function freshDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devices-itest-"));
  const p = path.join(dir, "whoop_data.db");
  fs.writeFileSync(p, "");
  return p;
}

describe("device_tokens helpers", () => {
  let dbPath: string;
  let originalDbPath: string | undefined;

  beforeEach(() => {
    originalDbPath = process.env.WHOOP_DB_PATH;
    dbPath = freshDbPath();
    process.env.WHOOP_DB_PATH = dbPath;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDbPath === undefined) delete process.env.WHOOP_DB_PATH;
    else process.env.WHOOP_DB_PATH = originalDbPath;
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  async function loadModules() {
    const conn = await import("./connection");
    const db = conn.openWrite();
    expect(db).not.toBeNull();
    // Bootstrap a second user (id=2) so transfer scenarios can use a real FK.
    db?.prepare("INSERT OR IGNORE INTO users (id) VALUES (2)").run();
    db?.close();
    const devices = await import("./devices");
    return { conn, devices };
  }

  it("upsertDeviceToken inserts a new row", async () => {
    const { devices } = await loadModules();
    const row = devices.upsertDeviceToken({
      user_id: 1,
      token: "a".repeat(64),
      platform: "ios",
      env: "development",
      app_version: "1.0(1)",
    });
    expect(row.user_id).toBe(1);
    expect(row.token).toBe("a".repeat(64));
    expect(row.platform).toBe("ios");
    expect(row.env).toBe("development");
    expect(row.app_version).toBe("1.0(1)");
    expect(row.created_at).toBeTruthy();
    expect(row.updated_at).toBe(row.created_at);
  });

  it("upsertDeviceToken on same (user, token) updates updated_at", async () => {
    const { devices } = await loadModules();
    const first = devices.upsertDeviceToken({
      user_id: 1,
      token: "b".repeat(64),
      platform: "ios",
      env: "development",
    });
    // Force a wall-clock difference; ISO string at ms precision rounds.
    await new Promise((r) => setTimeout(r, 5));
    const second = devices.upsertDeviceToken({
      user_id: 1,
      token: "b".repeat(64),
      platform: "ios",
      env: "production",
      app_version: "1.0(2)",
    });
    expect(second.user_id).toBe(1);
    expect(second.env).toBe("production");
    expect(second.app_version).toBe("1.0(2)");
    expect(second.created_at).toBe(first.created_at);
    expect(Date.parse(second.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(first.updated_at)
    );
  });

  it("upsertDeviceToken transfers an existing token to a new user_id", async () => {
    const { devices } = await loadModules();
    devices.upsertDeviceToken({
      user_id: 1,
      token: "c".repeat(64),
      platform: "ios",
      env: "development",
    });
    expect(devices.listDeviceTokensForUser(1)).toHaveLength(1);
    expect(devices.listDeviceTokensForUser(2)).toHaveLength(0);

    devices.upsertDeviceToken({
      user_id: 2,
      token: "c".repeat(64),
      platform: "ios",
      env: "development",
    });
    expect(devices.listDeviceTokensForUser(1)).toHaveLength(0);
    expect(devices.listDeviceTokensForUser(2)).toHaveLength(1);
  });

  it("listDeviceTokensForUser returns rows ordered by updated_at desc", async () => {
    const { devices } = await loadModules();
    devices.upsertDeviceToken({
      user_id: 1,
      token: "d".repeat(64),
      platform: "ios",
      env: "development",
    });
    await new Promise((r) => setTimeout(r, 5));
    devices.upsertDeviceToken({
      user_id: 1,
      token: "e".repeat(64),
      platform: "ios",
      env: "development",
    });
    const rows = devices.listDeviceTokensForUser(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].token).toBe("e".repeat(64));
    expect(rows[1].token).toBe("d".repeat(64));
  });

  it("deleteDeviceToken removes a single row and reports the count", async () => {
    const { devices } = await loadModules();
    devices.upsertDeviceToken({
      user_id: 1,
      token: "f".repeat(64),
      platform: "ios",
      env: "development",
    });
    expect(devices.deleteDeviceToken(1, "f".repeat(64))).toBe(1);
    expect(devices.deleteDeviceToken(1, "f".repeat(64))).toBe(0);
    expect(devices.listDeviceTokensForUser(1)).toHaveLength(0);
  });

  it("listDeviceTokensForUser returns [] when no rows exist", async () => {
    const { devices } = await loadModules();
    expect(devices.listDeviceTokensForUser(99)).toEqual([]);
  });
});
