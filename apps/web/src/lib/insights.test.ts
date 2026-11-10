// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const sdk = vi.hoisted(() => ({ create: vi.fn(), options: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: sdk.create };
    constructor(options: unknown) { sdk.options(options); }
  },
}));

import { openWrite } from "./db/connection";
import { getLatestInsight, saveInsight } from "./db/summary";
import { getGenerationFailure } from "./db/ai-generation";
import { acquireInsightRegenerationLock, getInsightStatus, insightToday, regenerateInsight } from "./insights";
import { titleChatThread } from "./coach/persistence";

let root: string;
let file: string;
function sql(fn: (db: Database.Database) => void) {
  const db = new Database(file);
  try { fn(db); } finally { db.close(); }
}
function bootstrap() {
  const db = openWrite();
  expect(db).not.toBeNull();
  db!.prepare("INSERT OR IGNORE INTO users (id, apple_sub, timezone) VALUES (2, 'real-user', 'America/New_York')").run();
  db!.prepare("INSERT INTO recovery (user_id, date, recovery_score, raw) VALUES (2, '2026-11-10', 70, ?)")
    .run(JSON.stringify({ updated_at: "2026-11-10T01:00:00Z" }));
  db!.close();
}
async function pageLoad(userId = 2, key: string | null = "fixture-key") {
  const lock = acquireInsightRegenerationLock(getInsightStatus(userId, true), key);
  if (lock && key) await regenerateInsight(userId, key, lock);
  return lock;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "insights-588-"));
  file = path.join(root, "fixture.db");
  new Database(file).close();
  vi.stubEnv("WHOOP_DB_PATH", file);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T03:30:00Z"));
  sdk.create.mockReset();
  sdk.options.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("insights migration and isolation", () => {
  it("upgrades a pre-change DB, claims the sole real user over bootstrap, and is idempotent", () => {
    sql((db) => db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, apple_sub TEXT UNIQUE, email TEXT, name TEXT, timezone TEXT, created_at TEXT);
      INSERT INTO users (id) VALUES (1);
      INSERT INTO users (id, apple_sub) VALUES (2, 'real-user');
      CREATE TABLE insights (date TEXT PRIMARY KEY, insight TEXT);
      INSERT INTO insights VALUES ('2026-11-09', 'legacy insight');
    `));
    // No accidental unscoped legacy read before the first write.
    expect(getLatestInsight(1)).toBeNull();
    openWrite()!.close();
    expect(getLatestInsight(2)?.insight).toBe("legacy insight");
    expect(getLatestInsight(1)).toBeNull();
    sql((db) => {
      const schemaVersion = db.pragma("schema_version", { simple: true });
      openWrite()!.close();
      expect(db.pragma("schema_version", { simple: true })).toBe(schemaVersion);
      const cols = db.pragma("table_info(insights)") as { name: string; pk: number }[];
      expect(cols.filter((col) => col.pk).map((col) => col.name)).toEqual(["user_id", "date"]);
    });
    saveInsight(1, "2026-11-09", "bootstrap insight");
    saveInsight(2, "2026-11-09", "real user's update");
    expect(getLatestInsight(1)?.insight).toBe("bootstrap insight");
    expect(getLatestInsight(2)?.insight).toBe("real user's update");
  });

  it("keeps ambiguous legacy ownership invisible", () => {
    sql((db) => db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, apple_sub TEXT UNIQUE, email TEXT, name TEXT, timezone TEXT, created_at TEXT);
      INSERT INTO users (id, apple_sub) VALUES (2, 'user-two'), (3, 'user-three');
      CREATE TABLE insights (date TEXT PRIMARY KEY, insight TEXT, created_at TEXT);
      INSERT INTO insights VALUES ('2026-11-09', 'private legacy insight', '2026-11-09T12:00:00Z');
    `));
    openWrite()!.close();
    expect(getLatestInsight(1)).toBeNull();
    expect(getLatestInsight(2)).toBeNull();
    expect(getLatestInsight(3)).toBeNull();
    sql((db) => expect(db.prepare("SELECT COUNT(*) AS n FROM insights WHERE user_id IS NULL").get()).toEqual({ n: 1 }));
  });
});

describe("insight reliability", () => {
  it("calls a failing provider at most once in each 1m, 5m, 30m backoff window, even with stale snapshots", async () => {
    bootstrap();
    sdk.create.mockRejectedValue(new Error("provider unavailable"));
    const staleSnapshot = getInsightStatus(2, true);
    const first = acquireInsightRegenerationLock(staleSnapshot, "fixture-key")!;
    expect(acquireInsightRegenerationLock(staleSnapshot, "fixture-key")).toBeNull();
    await regenerateInsight(2, "fixture-key", first);
    for (let attempt = 0; attempt < 50; attempt++) {
      expect(acquireInsightRegenerationLock(staleSnapshot, "fixture-key")).toBeNull();
      expect(await pageLoad()).toBeNull();
    }
    expect(sdk.create).toHaveBeenCalledTimes(1);
    for (const [index, delay] of [60_000, 300_000, 1_800_000, 1_800_000].entries()) {
      vi.setSystemTime(Date.now() + delay - 1);
      for (let attempt = 0; attempt < 10; attempt++) expect(await pageLoad()).toBeNull();
      expect(sdk.create).toHaveBeenCalledTimes(index + 1);
      vi.setSystemTime(Date.now() + 1);
      expect(await pageLoad()).not.toBeNull();
      expect(sdk.create).toHaveBeenCalledTimes(index + 2);
    }
    expect(sdk.options).toHaveBeenCalledWith({ apiKey: "fixture-key", timeout: 60_000, maxRetries: 1 });
    expect(getGenerationFailure(2, "insight")).toMatchObject({ error_class: "provider_error", failure_count: 5 });
    expect(getInsightStatus(2, true)).toMatchObject({ errorClass: "provider_error", isRegenerating: false });
    sql((db) => expect(db.prepare("SELECT level, user_id FROM server_logs WHERE message = 'insight_failed'").all())
      .toEqual(Array.from({ length: 5 }, () => ({ level: "error", user_id: 2 }))));
  });

  it("persists no-key and bad-key failures without exposing credentials, and recovers after replacement", async () => {
    bootstrap();
    await pageLoad(2, null);
    await pageLoad(2, null);
    expect(sdk.create).not.toHaveBeenCalled();
    expect(getGenerationFailure(2, "insight")).toMatchObject({ error_class: "no_key", failure_count: 1 });
    sdk.create.mockRejectedValue({ status: 401, message: "secret-fixture-key" });
    await pageLoad(2, "secret-fixture-key");
    expect(getInsightStatus(2, true).errorClass).toBe("bad_key");
    sql((db) => expect(JSON.stringify(db.prepare("SELECT * FROM server_logs").all())).not.toContain("secret-fixture-key"));
    sdk.create.mockResolvedValue({ content: [{ type: "text", text: "Recovered insight" }] });
    await pageLoad(2, "replacement-key");
    expect(getGenerationFailure(2, "insight")).toBeNull();
    expect(getLatestInsight(2)?.insight).toBe("Recovered insight");
  });

  it("does not share locks, failures, or generated insights across users", async () => {
    bootstrap();
    sql((db) => db.prepare("INSERT INTO recovery (user_id, date, recovery_score) VALUES (1, '2026-11-10', 40)").run());
    const first = acquireInsightRegenerationLock(getInsightStatus(1, true), "one")!;
    const second = acquireInsightRegenerationLock(getInsightStatus(2, true), "two")!;
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    sdk.create.mockRejectedValueOnce({ status: 503 });
    await regenerateInsight(1, "one", first);
    sdk.create.mockResolvedValueOnce({ content: [{ type: "text", text: "User two only" }] });
    await regenerateInsight(2, "two", second);
    expect(getInsightStatus(1, true).errorClass).toBe("provider_error");
    expect(getInsightStatus(2, true).errorClass).toBeNull();
    expect(getLatestInsight(1)).toBeNull();
    expect(getLatestInsight(2)?.insight).toBe("User two only");
  });

  it("uses the stored timezone across UTC midnight and regenerates at the local day boundary", async () => {
    bootstrap();
    expect(insightToday(2)).toBe("2026-11-09");
    sdk.create.mockResolvedValue({ content: [{ type: "text", text: "Today's insight" }] });
    await pageLoad();
    expect(sdk.create.mock.calls[0][0].model).toBe("claude-sonnet-4-6");
    expect(getLatestInsight(2)?.date).toBe("2026-11-09");
    expect(getInsightStatus(2, true).isStale).toBe(false);
    vi.setSystemTime(new Date("2026-11-10T05:00:00Z"));
    expect(insightToday(2)).toBe("2026-11-10");
    expect(getInsightStatus(2, true).isStale).toBe(true);
    sql((db) => db.prepare("INSERT INTO user_settings (user_id, tz, updated_at) VALUES (2, 'Asia/Tokyo', 'now')").run());
    vi.setSystemTime(new Date("2026-11-10T16:00:00Z"));
    expect(insightToday(2)).toBe("2026-11-11");
  });

  it("aborts a stalled request before its lock can expire and records a failure", async () => {
    bootstrap();
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    sdk.create.mockImplementation((_body, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("request timed out")));
    }));
    const lock = acquireInsightRegenerationLock(getInsightStatus(2, true), "key")!;
    const pending = regenerateInsight(2, "key", lock);
    expect(timeout).toHaveBeenCalledWith(125_000);
    expect(getInsightStatus(2, true).isRegenerating).toBe(true);
    deadline.abort();
    await pending;
    expect(getInsightStatus(2, true)).toMatchObject({ isRegenerating: false, errorClass: "provider_error" });
    expect(acquireInsightRegenerationLock(getInsightStatus(2, true), "key")).toBeNull();
  });

  it("treats empty provider output as failure and leaves the cached insight intact", async () => {
    bootstrap();
    saveInsight(2, "2026-11-08", "Cached insight");
    sdk.create.mockResolvedValue({ content: [] });
    await pageLoad();
    expect(getLatestInsight(2)?.insight).toBe("Cached insight");
    expect(getInsightStatus(2, true).errorClass).toBe("provider_error");
  });
});

describe("title reliability", () => {
  function thread(id: number) {
    sql((db) => db.prepare("INSERT INTO chat_threads (id, user_id) VALUES (?, 2)").run(id));
  }
  it("logs a bad key once, falls back for later threads, and retries when the key changes", async () => {
    bootstrap();
    sdk.create.mockRejectedValue({ status: 401 });
    for (const id of [1, 2, 3]) {
      thread(id);
      await titleChatThread(2, id, "Help me sleep better", "bad-key");
      vi.setSystemTime(Date.now() + 24 * 60 * 60_000);
    }
    expect(sdk.create).toHaveBeenCalledTimes(1);
    sql((db) => {
      expect(db.prepare("SELECT title FROM chat_threads").all()).toEqual(Array.from({ length: 3 }, () => ({ title: "Help me sleep better" })));
      expect(db.prepare("SELECT level FROM server_logs WHERE message = 'title_failed'").all()).toEqual([{ level: "error" }]);
    });
    sdk.create.mockResolvedValue({ content: [{ type: "text", text: "Better Sleep" }] });
    thread(4);
    await titleChatThread(2, 4, "Help me sleep better", "new-key");
    expect(sdk.create).toHaveBeenCalledTimes(2);
    expect(getGenerationFailure(2, "title")).toBeNull();
  });

  it("backs off credit/provider errors across different threads", async () => {
    bootstrap();
    sdk.create.mockRejectedValue({ status: 400, message: "credit balance" });
    thread(1); thread(2); thread(3);
    await titleChatThread(2, 1, "Sleep advice", "key");
    await titleChatThread(2, 2, "Recovery advice", "key");
    expect(sdk.create).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 60_000);
    await titleChatThread(2, 3, "Training advice", "key");
    expect(sdk.create).toHaveBeenCalledTimes(2);
  });
});
