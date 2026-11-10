// @vitest-environment node
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    // Vitest renders these unit tests outside a Server Component request.
    // Model React.cache's request-local argument memoization so the test can
    // exercise the two independently-created Request objects used by the
    // dashboard layout and page.
    cache: <T extends (...args: string[]) => Promise<unknown>>(fn: T): T => {
      const results = new Map<string, ReturnType<T>>();
      return ((...args: string[]) => {
        const key = JSON.stringify(args);
        const cached = results.get(key);
        if (cached) return cached;
        const result = fn(...args) as ReturnType<T>;
        results.set(key, result);
        return result;
      }) as unknown as T;
    },
  };
});
vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
}));
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return { ...actual, getUserById: vi.fn(actual.getUserById) };
});

const tmpRoot = mkdtempSync(path.join(tmpdir(), "auth-test-"));
const dbFile = path.join(tmpRoot, "test.db");
writeFileSync(dbFile, "");
process.env.WHOOP_DB_PATH = dbFile;
process.env.JWT_SIGNING_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32 bytes of base64

type AuthModule = typeof import("./auth");
type ConnectionModule = typeof import("./db/connection");
let auth: AuthModule;
let db: typeof import("./db");

beforeAll(async () => {
  const connection: ConnectionModule = await import("./db/connection");
  connection.openWrite()?.close();
  db = await import("./db");
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

describe("request-scoped auth cache", () => {
  it("performs one user lookup across a dashboard layout and page in one request", async () => {
    const { signSessionToken } = await import("./auth/jwt");
    const { token } = await signSessionToken(1);
    const getUserById = vi.mocked(db.getUserById);
    getUserById.mockClear();

    const layoutRequest = makeRequest({ cookie: `__Host-coach_session=${token}` });
    const pageRequest = makeRequest({ cookie: `__Host-coach_session=${token}` });
    await Promise.all([auth.requireAuth(layoutRequest), auth.requireAuth(pageRequest)]);

    expect(getUserById).toHaveBeenCalledTimes(1);
  });
});

describe("requireAuthOrSignin", () => {
  it("redirects unauthenticated page requests to /signin", async () => {
    const { redirect } = await import("next/navigation");
    await expect(auth.requireAuthOrSignin(makeRequest())).rejects.toThrow("NEXT_REDIRECT:/signin");
    expect(redirect).toHaveBeenCalledWith("/signin");
  });
});
