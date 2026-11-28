import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const requireAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAuth: (req: Request) => requireAuth(req) }));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "hono-api-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;
new Database(dbFile).close();

type AppModule = typeof import("./app");
type NextRouteModule = typeof import("@/app/api/dashboard/today/route");
type CatchAllModule = typeof import("@/app/api/[[...rest]]/route");
let api: AppModule;
let nextRoute: NextRouteModule;
let catchAll: CatchAllModule;

const MIN = 60_000;
const HOUR = 60 * MIN;

function withDb(fn: (d: Database.Database) => void): void {
  const d = new Database(dbFile);
  try {
    fn(d);
  } finally {
    d.close();
  }
}

function reset(): void {
  withDb((d) => {
    for (const t of ["recovery", "sleep", "cycles"]) d.prepare(`DELETE FROM ${t}`).run();
  });
}

/** 30 days of plausible rows ending `end`, with a gap on `end` itself. */
function seedHistory(end: string, days = 30): void {
  withDb((d) => {
    const rec = d.prepare(
      "INSERT OR REPLACE INTO recovery (user_id, date, recovery_score, hrv, rhr, spo2, skin_temp) VALUES (1, ?, ?, ?, ?, ?, ?)",
    );
    const slp = d.prepare(
      `INSERT OR REPLACE INTO sleep (user_id, sleep_id, date, in_bed_ms, light_ms, deep_ms, rem_ms, sleep_need_ms, performance, efficiency, nap)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    );
    const cyc = d.prepare(
      "INSERT OR REPLACE INTO cycles (user_id, date, strain, kilojoule, avg_hr, max_hr) VALUES (1, ?, ?, ?, ?, ?)",
    );
    for (let i = 1; i <= days; i++) {
      const date = shift(end, -i);
      rec.run(date, 40 + (i % 50), 45 + (i % 20), 48 + (i % 6), 96.5, 33.1);
      slp.run(`s-${date}`, date, 8 * HOUR, 3 * HOUR, 1.5 * HOUR, 2 * HOUR + i * MIN, 8 * HOUR, 80 + (i % 15), 90);
      cyc.run(date, 8 + (i % 9), 7000 + i * 10, 65 + (i % 7), 150 + (i % 20));
    }
  });
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const USER = { id: 1, email: "t@example.com", name: null, apple_sub: "sub", timezone: null };

function req(pathAndQuery: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathAndQuery}`, init);
}

beforeAll(async () => {
  const settings = await import("@/lib/db/settings");
  settings.setSetting("test_bootstrap", "1");
  api = await import("./app");
  nextRoute = await import("@/app/api/dashboard/today/route");
  catchAll = await import("@/app/api/[[...rest]]/route");
});

beforeEach(() => {
  reset();
  requireAuth.mockReset();
  requireAuth.mockResolvedValue({ user: USER, source: "ios" });
});

afterEach(() => {
  delete process.env.COACH_HONO_API;
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("Hono /api/dashboard/today parity with the Next route", () => {
  const END = "2026-05-20";
  const cases = [
    ["fallback (requested day empty)", `date=${END}`],
    ["requested day has data", `date=${shift(END, -1)}`],
    ["empty lookback", "date=2020-01-01"],
    ["empty ?date= means today", "date="],
    ["omitted ?date= means today", ""],
    ["malformed date", "date=garbage"],
    ["impossible calendar date", "date=2026-02-30"],
  ] as const;

  it.each(cases)("%s: identical status and body bytes", async (_label, query) => {
    seedHistory(END);
    const qs = query ? `?${query}` : "";
    const app = api.createApiApp();
    const viaHono = await app.fetch(req(`/api/dashboard/today${qs}`));
    const viaNext = await nextRoute.GET(req(`/api/dashboard/today${qs}`));

    expect(viaHono.status).toBe(viaNext.status);
    expect(viaHono.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await viaHono.text()).toBe(await viaNext.text());
  });

  it("fallback body has populated signals (parity is not vacuous)", async () => {
    seedHistory(END);
    const res = await api.createApiApp().fetch(req(`/api/dashboard/today?date=${END}`));
    const body = await res.json();
    expect(body.is_fallback).toBe(true);
    expect(body.data_date).toBe(shift(END, -1));
    expect(body.recovery.score).not.toBeNull();
    expect(body.signals.ots).not.toBeNull();
  });
});

describe("auth middleware", () => {
  it("returns requireAuth's thrown Response verbatim and never runs the handler", async () => {
    requireAuth.mockRejectedValue(new Response("Invalid token", { status: 401 }));
    const res = await api
      .createApiApp()
      .fetch(req("/api/dashboard/today", { headers: { authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Invalid token");
  });

  it("passes the raw request (headers intact) to requireAuth", async () => {
    await api
      .createApiApp()
      .fetch(req("/api/dashboard/today", { headers: { authorization: "Bearer abc" } }));
    expect(requireAuth).toHaveBeenCalledTimes(1);
    expect((requireAuth.mock.calls[0][0] as Request).headers.get("authorization")).toBe("Bearer abc");
  });

  it("rethrows non-Response errors", async () => {
    requireAuth.mockRejectedValue(new Error("db down"));
    const res = await api.createApiApp().fetch(req("/api/dashboard/today"));
    expect(res.status).toBe(500);
  });
});

describe("draft OpenAPI document", () => {
  it("is OpenAPI 3.1 and describes the dashboard route", async () => {
    const res = await api.createApiApp().fetch(req("/api/openapi.json"));
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.openapi).toBe("3.1.0");
    const op = doc.paths["/api/dashboard/today"].get;
    expect(op.parameters).toEqual([
      expect.objectContaining({ name: "date", in: "query", required: false }),
    ]);
    expect(Object.keys(op.responses).sort()).toEqual(["200", "400", "401"]);
    expect(doc.components.schemas.DashboardToday.required).toEqual(
      expect.arrayContaining(["requested_date", "data_date", "is_fallback", "signals"]),
    );
    expect(Object.keys(doc.components.securitySchemes).sort()).toEqual(["bearerAuth", "cookieAuth"]);
  });
});

describe("draft OpenAPI document auth", () => {
  it("requires auth (proxy only checks credential presence)", async () => {
    requireAuth.mockRejectedValue(new Response("Unauthorized", { status: 401 }));
    const res = await api
      .createApiApp()
      .fetch(req("/api/openapi.json", { headers: { cookie: "__Host-coach_session=forged" } }));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });
});

describe("api/[[...rest]] catch-all mount", () => {
  it("is default-off: defers to Next's not-found when COACH_HONO_API is unset", () => {
    expect(api.isHonoApiEnabled({})).toBe(false);
    expect(api.isHonoApiEnabled({ COACH_HONO_API: "true" })).toBe(false);
    let thrown: unknown;
    try {
      catchAll.GET(req("/api/openapi.json"));
    } catch (err) {
      thrown = err;
    }
    // next/navigation notFound() throws its framework control-flow error.
    expect((thrown as { digest?: string })?.digest).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("serves the Hono app when COACH_HONO_API=1", async () => {
    process.env.COACH_HONO_API = "1";
    const spec = await catchAll.GET(req("/api/openapi.json"));
    expect(spec.status).toBe(200);
    const unknown = await catchAll.GET(req("/api/does-not-exist"));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "Not found" });
  });
});
