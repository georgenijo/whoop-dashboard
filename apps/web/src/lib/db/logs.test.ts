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
});
