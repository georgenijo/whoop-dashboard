// @vitest-environment node
//
// GET /api/export against a real temp SQLite file (WHOOP_DB_PATH), two users.
// Proves: flag-off 404 (before auth), tenant isolation in every dataset and
// format, range bounds, CSV escaping/formula-injection safety, headers.
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const auth = vi.hoisted(() => ({ userId: 1, calls: 0 }));
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => {
    auth.calls++;
    return {
      user: { id: auth.userId, email: null, name: null, apple_sub: `sub-${auth.userId}`, timezone: null },
      source: "web" as const,
    };
  }),
}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "export-route-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;
new Database(dbFile).close();

type RouteModule = typeof import("./route");
let route: RouteModule;

const A = 1;
const B = 2;
const SECRET = "B-ONLY-SECRET";

beforeAll(async () => {
  const { openWrite } = await import("@/lib/db/connection");
  openWrite(); // lazy-creates schema
  const d = new Database(dbFile);
  try {
    for (const u of [A, B]) d.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(u);
    const rec = d.prepare(
      "INSERT INTO recovery (user_id, date, recovery_score, hrv, rhr, spo2, skin_temp) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const cyc = d.prepare(
      "INSERT INTO cycles (user_id, date, strain, kilojoule, avg_hr, max_hr) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const slp = d.prepare(
      `INSERT INTO sleep (user_id, sleep_id, date, in_bed_ms, performance, nap, start_local, end_local, cycles)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const wk = d.prepare(
      `INSERT INTO workouts (user_id, id, date, sport, duration_sec, avg_hr, max_hr, strain, kilojoule, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const steps = d.prepare(
      "INSERT INTO daily_steps (user_id, date, steps, source) VALUES (?, ?, ?, 'apple_health')",
    );
    // User A: a gap on 2026-03-02, a null HRV, a negative skin temp.
    rec.run(A, "2026-03-01", 71, 62.5, 51, 96.1, -0.4);
    rec.run(A, "2026-03-03", 44, null, 55, null, 0.2);
    cyc.run(A, "2026-03-01", 12.3, 9800, 70, 168);
    slp.run(A, "sA1", "2026-03-01", 27_000_000, 88, 0, "2026-02-28T23:10:00", "2026-03-01T06:40:00", 4);
    slp.run(A, "sA1n", "2026-03-01", 1_800_000, 60, 1, "2026-03-01T14:00:00", "2026-03-01T14:30:00", null);
    wk.run(A, "wA2", "2026-03-01", "Running", 1800, 150, 180, 10.1, 1500,
      JSON.stringify({ start: "2026-03-01T17:00:00Z", end: "2026-03-01T17:30:00Z" }));
    wk.run(A, "wA1", "2026-03-01", '=HYPERLINK("http://evil","x")', 600, 120, 140, 3.2, 300,
      JSON.stringify({ start: "2026-03-01T07:00:00Z", end: "2026-03-01T07:10:00Z" }));
    steps.run(A, "2026-03-01", 8123);

    // User B: same dates, distinctive values that must never appear for A.
    rec.run(B, "2026-03-01", 99, 199.9, 39, 99.9, 1.9);
    cyc.run(B, "2026-03-01", 20.9, 99999, 99, 199);
    slp.run(B, "sB1", "2026-03-01", 99_999_999, 99, 0, null, null, 7);
    wk.run(B, "wB1", "2026-03-01", SECRET, 9999, 199, 210, 20.9, 9999,
      JSON.stringify({ start: "2026-03-01T09:00:00Z" }));
    steps.run(B, "2026-03-01", 99999);
  } finally {
    d.close();
  }
  route = await import("./route");
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.DATA_EXPORT = "1";
  auth.userId = A;
  auth.calls = 0;
});

afterEach(() => {
  delete process.env.DATA_EXPORT;
});

function get(qs: string): Promise<Response> {
  return route.GET(new Request(`http://localhost/api/export?${qs}`));
}

const RANGE = "from=2026-03-01&to=2026-03-03";

describe("flag", () => {
  it.each([undefined, "0", "true", "yes", ""])("DATA_EXPORT=%s → 404 without auth", async (v) => {
    if (v === undefined) delete process.env.DATA_EXPORT;
    else process.env.DATA_EXPORT = v;
    const res = await get(`kind=all&format=json&${RANGE}`);
    expect(res.status).toBe(404);
    expect(auth.calls).toBe(0);
  });

  it("DATA_EXPORT=1 → 200", async () => {
    const res = await get(`kind=recovery&${RANGE}`);
    expect(res.status).toBe(200);
    expect(auth.calls).toBe(1);
  });
});

describe("tenant isolation", () => {
  it("kind=all JSON for A contains only A's rows", async () => {
    const res = await get(`kind=all&format=json&${RANGE}`);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.version).toBe(1);
    expect(body.user_scope).toBe("self");
    expect(body.range).toEqual({ from: "2026-03-01", to: "2026-03-03", days: 3 });
    expect(body.rows.recovery.map((r: { recovery_score: number }) => r.recovery_score)).toEqual([71, 44]);
    expect(body.rows.cycles).toHaveLength(1);
    expect(body.rows.cycles[0].kilojoule).toBe(9800);
    expect(body.rows.sleep.map((r: { nap: boolean }) => r.nap)).toEqual([false, true]);
    expect(body.rows.sleep[0].sleep_cycles).toBe(4);
    expect(body.rows.sleep[1].in_bed_ms).toBe(1_800_000);
    expect(body.rows.workouts).toHaveLength(2);
    expect(body.rows.steps).toEqual([{ date: "2026-03-01", steps: 8123, source: "apple_health" }]);
    for (const leak of [SECRET, "99999", "199.9", "wB1", "sB1", "wA1", "sA1", "user_id"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("kind=all CSV for B contains only B's rows", async () => {
    auth.userId = B;
    const res = await get(`kind=all&format=csv&${RANGE}`);
    const text = await res.text();
    expect(text).toContain(SECRET);
    expect(text).not.toContain("HYPERLINK");
    expect(text).not.toContain("8123");
    expect(text).not.toContain("Running");
    // header + recovery + cycles + sleep + workouts + steps, one each
    expect(text.trimEnd().split("\r\n")).toHaveLength(6);
  });

  it.each(["recovery", "sleep", "workouts", "cycles", "steps"])(
    "kind=%s never returns the other user's values",
    async (kind) => {
      const a = await (await get(`kind=${kind}&format=json&${RANGE}`)).text();
      auth.userId = B;
      const b = await (await get(`kind=${kind}&format=json&${RANGE}`)).text();
      expect(a).not.toContain(SECRET);
      expect(a).not.toMatch(/9999|199\.9|20\.9/);
      expect(b).not.toContain("8123");
      expect(b).not.toContain("9800");
      expect(b).not.toContain("HYPERLINK");
    },
  );
});

describe("bounds and params", () => {
  it("rejects a span over 400 days", async () => {
    const res = await get("kind=recovery&from=2025-01-01&to=2026-03-01");
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/400 days/);
  });

  it("accepts exactly 400 days", async () => {
    const res = await get("kind=recovery&from=2025-01-26&to=2026-03-01");
    expect(res.status).toBe(200);
  });

  it.each([
    "kind=tokens",
    "kind=chat_messages",
    "format=xml",
    "from=2026-02-30",
    "to=03/01/2026",
    "from=2026-03-05&to=2026-03-01",
  ])("400 for %s", async (qs) => {
    expect((await get(qs)).status).toBe(400);
  });

  it("blank dates (an empty <input type=date>) fall back to the 90-day default", async () => {
    const res = await get("kind=recovery&format=json&from=&to=");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.range.days).toBe(90);
  });

  it("empty range → header-only CSV", async () => {
    const text = await (await get("kind=recovery&from=2020-01-01&to=2020-01-31")).text();
    expect(text).toBe("date,recovery_score,hrv,rhr,spo2,skin_temp\r\n");
  });
});

describe("CSV output", () => {
  it("is attachment-disposed with a dated filename and no-store", async () => {
    const res = await get(`kind=workouts&format=csv&${RANGE}`);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="whoop-export-workouts-2026-03-01_to_2026-03-03.csv"',
    );
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-export-truncated")).toBe("0");
  });

  it("neutralises formulas, quotes, keeps negatives numeric, orders chronologically", async () => {
    const workouts = await (await get(`kind=workouts&format=csv&${RANGE}`)).text();
    const lines = workouts.split("\r\n");
    expect(lines[0]).toBe(
      "date,start_utc,end_utc,sport,duration_sec,strain,kilojoule,avg_hr,max_hr,distance_m,zone_0_ms,zone_1_ms,zone_2_ms,zone_3_ms,zone_4_ms,zone_5_ms",
    );
    // 07:00 workout before 17:00, despite the reader's DESC order.
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(lines[2]).toContain("Running");

    const rec = await (await get(`kind=recovery&format=csv&${RANGE}`)).text();
    expect(rec).toBe(
      "date,recovery_score,hrv,rhr,spo2,skin_temp\r\n" +
        "2026-03-01,71,62.5,51,96.1,-0.4\r\n" +
        "2026-03-03,44,,55,,0.2\r\n",
    );
  });
});
