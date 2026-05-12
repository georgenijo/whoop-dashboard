// @vitest-environment node
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "auth-test-"));
const dbFile = path.join(tmpRoot, "test.db");
writeFileSync(dbFile, "");
process.env.WHOOP_DB_PATH = dbFile;
process.env.JWT_SIGNING_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32 bytes of base64

type AuthModule = typeof import("./auth");
type ConnectionModule = typeof import("./db/connection");
let auth: AuthModule;

beforeAll(async () => {
  const connection: ConnectionModule = await import("./db/connection");
  connection.openWrite()?.close();
  auth = await import("./auth");
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/whatever", { headers });
}

describe("requireAuth — Bearer → Cookie → 401", () => {
  it("throws 401 when neither bearer nor cookie is present", async () => {
    await expect(auth.requireAuth(makeRequest())).rejects.toMatchObject({
      status: 401,
    });
  });

  it("throws 401 when only a CF Access JWT assertion header is present (no fallback)", async () => {
    // Regression: pre-Phase-B, this header would have authenticated the
    // request via verifyCFAccessJWT + findOrCreateUserByEmail. That branch
    // is gone; the header must be ignored entirely.
    await expect(
      auth.requireAuth(
        makeRequest({ "cf-access-jwt-assertion": "anything.at.all" })
      )
    ).rejects.toMatchObject({ status: 401 });
  });

  it("throws 401 for a malformed Authorization header", async () => {
    await expect(
      auth.requireAuth(makeRequest({ authorization: "NotBearer foo" }))
    ).rejects.toMatchObject({ status: 401 });
  });

  it("throws 401 for an invalid bearer token", async () => {
    await expect(
      auth.requireAuth(makeRequest({ authorization: "Bearer not-a-jwt" }))
    ).rejects.toMatchObject({ status: 401 });
  });

  it("throws 401 for an invalid session cookie", async () => {
    await expect(
      auth.requireAuth(makeRequest({ cookie: "__Host-coach_session=garbage" }))
    ).rejects.toMatchObject({ status: 401 });
  });
});
