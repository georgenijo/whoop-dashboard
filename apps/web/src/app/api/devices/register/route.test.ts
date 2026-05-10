// @vitest-environment node
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "devices-register-route-"));
const dbFile = path.join(tmpRoot, "test.db");
writeFileSync(dbFile, "");
process.env.WHOOP_DB_PATH = dbFile;
// Force test path through the dev-bootstrap branch in requireAuth.
process.env.NODE_ENV = "test";

type RouteModule = typeof import("./route");
type ConnectionModule = typeof import("@/lib/db/connection");
let route: RouteModule;

function readRow(token: string) {
  const db = new Database(dbFile);
  try {
    return db
      .prepare(
        "SELECT user_id, token, platform, env, app_version FROM device_tokens WHERE token = ?"
      )
      .get(token) as
      | {
          user_id: number;
          token: string;
          platform: string;
          env: string;
          app_version: string | null;
        }
      | undefined;
  } finally {
    db.close();
  }
}

function clearTokens(): void {
  const db = new Database(dbFile);
  try {
    db.prepare("DELETE FROM device_tokens").run();
  } finally {
    db.close();
  }
}

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/devices/register", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeAll(async () => {
  const connection: ConnectionModule = await import("@/lib/db/connection");
  // Bootstrap schema (creates users + device_tokens). openWrite seeds user 1.
  connection.openWrite()?.close();
  route = await import("./route");
});

beforeEach(() => {
  clearTokens();
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("POST /api/devices/register", () => {
  it("registers a valid token under the bootstrap user", async () => {
    const token = "a".repeat(64);
    const res = await route.POST(
      makeRequest({
        token,
        platform: "ios",
        env: "production",
        app_version: "1.0(1)",
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
    const row = readRow(token);
    expect(row?.user_id).toBe(1);
    expect(row?.platform).toBe("ios");
    expect(row?.env).toBe("production");
    expect(row?.app_version).toBe("1.0(1)");
  });

  it("rejects malformed JSON with 400 invalid_request", async () => {
    const res = await route.POST(makeRequest("{not json"));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("invalid_request");
  });

  it("rejects a non-hex token with 400 invalid_token", async () => {
    const res = await route.POST(
      makeRequest({
        token: "not-a-hex-token",
        platform: "ios",
        env: "production",
      })
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("invalid_token");
  });

  it("rejects a non-ios platform with 400 invalid_platform", async () => {
    const res = await route.POST(
      makeRequest({
        token: "b".repeat(64),
        platform: "android",
        env: "production",
      })
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("invalid_platform");
  });

  it("rejects an invalid env with 400 invalid_env", async () => {
    const res = await route.POST(
      makeRequest({
        token: "c".repeat(64),
        platform: "ios",
        env: "staging",
      })
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("invalid_env");
  });

  it("returns 401 when Authorization header is malformed in production", async () => {
    process.env.NODE_ENV = "production";
    try {
      const res = await route.POST(
        makeRequest(
          {
            token: "d".repeat(64),
            platform: "ios",
            env: "production",
          },
          { authorization: "NotBearer foo" }
        )
      );
      expect(res.status).toBe(401);
    } finally {
      process.env.NODE_ENV = "test";
    }
  });

  it("rejects an empty trimmed app_version cleanly (treats as null)", async () => {
    const token = "e".repeat(64);
    const res = await route.POST(
      makeRequest({
        token,
        platform: "ios",
        env: "production",
        app_version: "   ",
      })
    );
    expect(res.status).toBe(200);
    expect(readRow(token)?.app_version).toBeNull();
  });
});
