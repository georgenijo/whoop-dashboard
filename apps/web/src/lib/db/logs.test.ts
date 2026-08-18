// @vitest-environment node
//
// Issue #494 — chat_logs and sync_logs were readable across tenants, and the
// sync-cooldown gate that getLastSuccessfulSyncAt() feeds was global.
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "logs-db-"));

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function newDbFile(): string {
  const file = path.join(tmpRoot, `db-${Math.random().toString(36).slice(2)}.db`);
  new Database(file).close();
  return file;
}

type LogsModule = typeof import("./logs");

/** Fresh DB with the current schema plus a second account. */
async function bootstrap(): Promise<LogsModule> {
  const file = newDbFile();
  process.env.WHOOP_DB_PATH = file;
  const conn = await import("./connection");
  conn.openWrite()?.close();
  const raw = new Database(file);
  raw.prepare("INSERT OR IGNORE INTO users (id) VALUES (2)").run();
  raw.close();
  return import("./logs");
}

describe("chat_logs — tenant scoping", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("getChatLogs returns only the caller's rows", async () => {
    const logs = await bootstrap();

    logs.addChatLog({
      user_id: 1,
      started_at: "2026-05-01T00:00:00Z",
      prompt_preview: "user one secret prompt",
      duration_ms: 10,
      status: "ok",
      response_length: 5,
      error_message: null,
      days_context: null,
      type: "api",
      source: "web",
      details: null,
      thread_id: null,
    });
    logs.addChatLog({
      user_id: 2,
      started_at: "2026-05-02T00:00:00Z",
      prompt_preview: "user two prompt",
      duration_ms: 20,
      status: "ok",
      response_length: 5,
      error_message: null,
      days_context: null,
      type: "api",
      source: "web",
      details: null,
      thread_id: null,
    });

    const u1 = logs.getChatLogs(1);
    expect(u1.map((r) => r.prompt_preview)).toEqual(["user one secret prompt"]);
    expect(u1[0].user_id).toBe(1);

    const u2 = logs.getChatLogs(2);
    expect(u2.map((r) => r.prompt_preview)).toEqual(["user two prompt"]);
    expect(JSON.stringify(u2)).not.toContain("secret");
  });

  it("clearChatLogs deletes only the caller's rows", async () => {
    const logs = await bootstrap();
    for (const uid of [1, 2]) {
      logs.addChatLog({
        user_id: uid,
        started_at: "2026-05-01T00:00:00Z",
        prompt_preview: `prompt ${uid}`,
        duration_ms: 10,
        status: "ok",
        response_length: 5,
        error_message: null,
        days_context: null,
        type: "api",
        source: "web",
        details: null,
        thread_id: null,
      });
    }

    logs.clearChatLogs(2);

    expect(logs.getChatLogs(1)).toHaveLength(1);
    expect(logs.getChatLogs(2)).toHaveLength(0);
  });
});

function syncLog(
  userId: number | null,
  startedAt: string,
  status: "ok" | "error" = "ok",
) {
  return {
    user_id: userId,
    started_at: startedAt,
    duration_ms: 100,
    status,
    recovery_count: 1,
    sleep_count: 1,
    workouts_count: 0,
    error_message: null,
    source: "manual",
    details: null,
    partial: false,
  };
}

describe("sync_logs — tenant scoping", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("getSyncLogs returns only the caller's rows", async () => {
    const logs = await bootstrap();
    logs.addSyncLog(syncLog(1, "2026-05-01T00:00:00Z"));
    logs.addSyncLog(syncLog(2, "2026-05-02T00:00:00Z"));

    expect(logs.getSyncLogs(1).map((r) => r.started_at)).toEqual([
      "2026-05-01T00:00:00Z",
    ]);
    expect(logs.getSyncLogs(2).map((r) => r.started_at)).toEqual([
      "2026-05-02T00:00:00Z",
    ]);
  });

  it("unattributed (NULL user_id) webhook rows are invisible to every tenant", async () => {
    const logs = await bootstrap();
    logs.addSyncLog({ ...syncLog(null, "2026-05-03T00:00:00Z"), source: "webhook" });

    expect(logs.getSyncLogs(1)).toHaveLength(0);
    expect(logs.getSyncLogs(2)).toHaveLength(0);
    expect(logs.getLastSuccessfulSyncAt(1)).toBeNull();
    expect(logs.getLastSuccessfulSyncAt(2)).toBeNull();
  });

  it("getLastSuccessfulSyncAt is per-user: A's sync does not gate B", async () => {
    const logs = await bootstrap();
    const aSyncedAt = "2026-05-04T12:00:00.000Z";
    logs.addSyncLog(syncLog(1, aSyncedAt));

    // User A sees their own sync — the cooldown gate will fire for them.
    expect(logs.getLastSuccessfulSyncAt(1)?.toISOString()).toBe(aSyncedAt);
    // User B has never synced. Pre-#494 this returned A's timestamp, which
    // both disclosed it and suppressed B's sync for the cooldown window.
    expect(logs.getLastSuccessfulSyncAt(2)).toBeNull();
  });

  it("getLastSuccessfulSyncAt ignores the caller's failed syncs", async () => {
    const logs = await bootstrap();
    logs.addSyncLog(syncLog(1, "2026-05-05T00:00:00Z", "error"));
    expect(logs.getLastSuccessfulSyncAt(1)).toBeNull();
  });

  it("getLastSuccessfulSyncAt ignores keepalive (#273) rows, so the 30-min token-refresh ping can't mask a stale real sync", async () => {
    const logs = await bootstrap();
    // A real sync happened once, a while ago...
    const realSyncedAt = "2026-05-01T00:00:00.000Z";
    logs.addSyncLog(syncLog(1, realSyncedAt));
    // ...then only the refresh-only keepalive has run since, repeatedly.
    // Without the source exclusion, each of these would look like a fresh
    // "successful sync" and permanently wedge the /api/sync cooldown gate —
    // a real sync would never be allowed to run again.
    logs.addSyncLog({
      ...syncLog(1, "2026-05-10T00:00:00.000Z"),
      recovery_count: null,
      sleep_count: null,
      workouts_count: null,
      source: "keepalive",
    });
    logs.addSyncLog({
      ...syncLog(1, "2026-05-15T00:00:00.000Z"),
      recovery_count: null,
      sleep_count: null,
      workouts_count: null,
      source: "keepalive",
    });

    expect(logs.getLastSuccessfulSyncAt(1)?.toISOString()).toBe(realSyncedAt);
  });
});

function routeLog(userId: number | null, startedAt: string, route: string) {
  return {
    user_id: userId,
    started_at: startedAt,
    route,
    duration_ms: 50,
    status: 200,
    details: null,
    response_bytes: null,
    render_ms: 10,
  };
}

describe("route_logs — tenant scoping (issue #499)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("getRouteLogs returns only the caller's rows", async () => {
    const logs = await bootstrap();
    logs.addRouteLog(routeLog(1, "2026-05-01T00:00:00Z", "/recovery"));
    logs.addRouteLog(routeLog(2, "2026-05-02T00:00:00Z", "/sleep"));

    const u1 = logs.getRouteLogs(1);
    expect(u1.map((r) => r.route)).toEqual(["/recovery"]);
    expect(u1[0].user_id).toBe(1);

    const u2 = logs.getRouteLogs(2);
    expect(u2.map((r) => r.route)).toEqual(["/sleep"]);
  });

  it("unattributed (NULL user_id) rows are invisible to every tenant", async () => {
    const logs = await bootstrap();
    logs.addRouteLog(routeLog(null, "2026-05-03T00:00:00Z", "/signin"));

    expect(logs.getRouteLogs(1)).toHaveLength(0);
    expect(logs.getRouteLogs(2)).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // Issue #505 — the "real edge": a DB file where openWrite() has NEVER
  // run yet. Before the fix, openRouteLogWrite() called
  // addUserIdColumnAndClaimLegacyRows() directly, which does
  // `SELECT id FROM users` — but `users` doesn't exist on a totally fresh
  // file, so it threw, the throw was swallowed, addRouteLog() silently
  // dropped the row, and route_logs was left without `user_id` until the
  // next openWrite() call.
  // ---------------------------------------------------------------------

  it("addRouteLog on a DB where openWrite() has never run does not drop the row, and route_logs ends up with a correct schema", async () => {
    const file = path.join(tmpRoot, `db-${Math.random().toString(36).slice(2)}.db`);
    // Only create the empty file — deliberately skip calling openWrite() or
    // seeding `users`, unlike bootstrap() above.
    new Database(file).close();
    process.env.WHOOP_DB_PATH = file;
    const logs = await import("./logs");

    // Must not throw, and must not silently no-op.
    logs.addRouteLog(routeLog(null, "2026-05-01T00:00:00Z", "/recovery"));

    // The fallback path (delegating to a one-time openWrite()) creates the
    // sole bootstrap user (id=1), so a NULL-user_id insert immediately after
    // still can't be retroactively claimed — but the SCHEMA must be correct:
    // route_logs must exist with every column, including user_id, and the
    // row must be present (not dropped).
    const raw = new Database(file, { readonly: true });
    try {
      const cols = (raw.prepare("PRAGMA table_info(route_logs)").all() as { name: string }[]).map(
        (c) => c.name
      );
      expect(cols).toEqual(
        expect.arrayContaining([
          "id",
          "started_at",
          "route",
          "duration_ms",
          "status",
          "details",
          "response_bytes",
          "render_ms",
          "user_id",
        ])
      );
      const row = raw.prepare("SELECT route FROM route_logs WHERE id = 1").get() as
        | { route: string }
        | undefined;
      expect(row?.route).toBe("/recovery");
    } finally {
      raw.close();
    }
  });

  it("a user_id-attributed addRouteLog on a never-migrated DB is attributed correctly once users exist", async () => {
    const file = path.join(tmpRoot, `db-${Math.random().toString(36).slice(2)}.db`);
    new Database(file).close();
    process.env.WHOOP_DB_PATH = file;
    const conn = await import("./connection");
    // Seed a single user directly via the raw file — still without ever
    // calling openWrite() — so the fallback path's one-time openWrite() call
    // sees an existing sole user rather than creating a fresh one.
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        apple_sub TEXT UNIQUE,
        email TEXT,
        name TEXT,
        timezone TEXT
      )
    `);
    raw.prepare("INSERT INTO users (id) VALUES (1)").run();
    raw.close();

    const logs = await import("./logs");
    logs.addRouteLog(routeLog(1, "2026-05-01T00:00:00Z", "/sleep"));

    expect(logs.getRouteLogs(1).map((r) => r.route)).toEqual(["/sleep"]);
    // Confirm the fallback truly ran openWrite()'s full bootstrap, not a
    // partial one — e.g. chat_logs should exist and be migrated too.
    const chatDb = conn.openWrite();
    expect(chatDb).not.toBeNull();
    chatDb?.close();
  });
});
