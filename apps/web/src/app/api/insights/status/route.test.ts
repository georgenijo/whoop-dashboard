// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { openWrite } from "@/lib/db/connection";
import { saveInsight } from "@/lib/db/summary";
import { saveGenerationFailure } from "@/lib/db/ai-generation";
import { signSessionToken } from "@/lib/auth/jwt";
import { GET } from "./route";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "insight-status-"));
  const file = path.join(root, "fixture.db");
  new Database(file).close();
  vi.stubEnv("WHOOP_DB_PATH", file);
  vi.stubEnv("JWT_SIGNING_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
  const db = openWrite()!;
  db.prepare("INSERT INTO users (id) VALUES (2)").run();
  const date = new Date().toISOString().slice(0, 10);
  db.prepare("INSERT INTO recovery (user_id, date, recovery_score) VALUES (1, ?, 75)").run(date);
  db.close();
  saveInsight(1, date, "Private to user one");
  saveGenerationFailure(2, "insight", "provider_error", null);
  saveGenerationFailure(2, "title", "bad_key", null);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

const request = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/insights/status?userId=1", { headers });

describe("GET /api/insights/status", () => {
  it("rejects unauthenticated and invalid bearer requests with 401", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request({ authorization: "Bearer bogus" }))).status).toBe(401);
  });
  it("authenticates bearer sessions and exposes only the caller's status, never cached content or key hashes", async () => {
    const { token } = await signSessionToken(2);
    const response = await GET(request({ authorization: `Bearer ${token}` }));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      ready: false, isRegenerating: false, errorClass: "provider_error",
      nextRetryAt: expect.any(String), titleErrorClass: "bad_key",
    });
  });
  it("supports the web session cookie and reports ready without triggering generation", async () => {
    const { token } = await signSessionToken(1);
    const response = await GET(request({ cookie: `__Host-coach_session=${token}` }));
    expect(await response.json()).toEqual({
      ready: true, isRegenerating: false, errorClass: null, nextRetryAt: null, titleErrorClass: null,
    });
  });
});
