// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import * as AnthropicSdk from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
}));

const logError = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => {
  class MockApiError extends Error {
    status: number;
    constructor(status: number) {
      super(`anthropic ${status}`);
      this.status = status;
      this.name = "APIError";
    }
  }
  class MockAnthropic {
    messages = { create: sdk.create };
    constructor() {}
  }
  return { default: MockAnthropic, APIError: MockApiError };
});

vi.mock("@/lib/logger", () => ({
  forModule: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: logError,
    fatal: vi.fn(),
  }),
}));

type InsightsModule = typeof import("./insights");
type DbModule = typeof import("./db");
type UserSettingsModule = typeof import("./db/user_settings");

let dbPath: string;
let insights: InsightsModule;
let db: DbModule;
let userSettings: UserSettingsModule;
let originalDbPath: string | undefined;

function freshDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "insights-588-"));
  return path.join(dir, "whoop_data.db");
}

function apiError(status: number): Error {
  const ApiError = AnthropicSdk.APIError as unknown as new (
    status: number,
  ) => Error;
  return new ApiError(status);
}

async function load() {
  db = await import("./db");
  userSettings = await import("./db/user_settings");
  insights = await import("./insights");
}

beforeEach(() => {
  originalDbPath = process.env.WHOOP_DB_PATH;
  dbPath = freshDbPath();
  new Database(dbPath).close();
  process.env.WHOOP_DB_PATH = dbPath;
  vi.resetModules();
  sdk.create.mockReset();
  logError.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  if (originalDbPath === undefined) delete process.env.WHOOP_DB_PATH;
  else process.env.WHOOP_DB_PATH = originalDbPath;
  try {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("insights tenant migration (issue #588)", () => {
  it("upgrades a pre-change DB once, claims legacy rows, and isolates users", async () => {
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        apple_sub TEXT UNIQUE,
        email TEXT,
        name TEXT,
        timezone TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users (id, email) VALUES (1, 'owner@example.com');
      CREATE TABLE insights (
        date TEXT PRIMARY KEY,
        insight TEXT,
        created_at TEXT
      );
      INSERT INTO insights (date, insight, created_at)
      VALUES ('2026-07-01', 'legacy insight', '2026-07-01T12:00:00.000Z');
    `);
    raw.close();

    const connection = await import("./db/connection");
    const first = connection.openWrite();
    expect(first).not.toBeNull();
    const columns = (
      first!
        .prepare("PRAGMA table_info(insights)")
        .all() as { name: string; pk: number }[]
    );
    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(["user_id", "date", "insight", "created_at"]),
    );
    expect(
      columns
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name),
    ).toEqual(["user_id", "date"]);
    expect(
      first!
        .prepare("SELECT user_id, date, insight FROM insights")
        .all(),
    ).toEqual([
      { user_id: 1, date: "2026-07-01", insight: "legacy insight" },
    ]);
    first!.close();

    // Re-opening must not rebuild again or duplicate the legacy row.
    const second = connection.openWrite();
    expect(second).not.toBeNull();
    expect(
      second!.prepare("SELECT COUNT(*) AS n FROM insights").get(),
    ).toEqual({ n: 1 });
    second!.close();

    await load();
    const db2 = new Database(dbPath);
    db2.prepare("INSERT INTO users (id) VALUES (2)").run();
    db2.close();

    db.saveInsight(1, "2026-11-10", "user one insight");
    db.saveInsight(2, "2026-11-10", "user two insight");

    expect(db.getLatestInsight(1)).toEqual({
      date: "2026-11-10",
      insight: "user one insight",
      created_at: expect.any(String),
    });
    expect(db.getLatestInsight(2)).toEqual({
      date: "2026-11-10",
      insight: "user two insight",
      created_at: expect.any(String),
    });
  });
});

describe("insight generation backoff (issue #588)", () => {
  it("calls a failing provider at most once per backoff window across page loads", async () => {
    vi.useFakeTimers();
    const start = new Date("2026-11-10T12:00:00.000Z");
    vi.setSystemTime(start);

    const connection = await import("./db/connection");
    const writer = connection.openWrite();
    writer!
      .prepare(
        "INSERT INTO recovery (user_id, date, recovery_score) VALUES (1, '2026-11-10', 70)",
      )
      .run();
    writer!.close();

    await load();

    function pageLoadAttempt() {
      const status = insights.getInsightStatus(1, true);
      expect(status.isStale).toBe(true);
      return insights.acquireInsightRegenerationLock(1, status, "sk-ant-test");
    }

    sdk.create.mockRejectedValueOnce(apiError(500));
    const first = pageLoadAttempt();
    expect(first).not.toBeNull();
    await insights.regenerateInsight(1, "sk-ant-test", first!);

    expect(sdk.create).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 1, error_class: "provider_error" }),
      "insight_regeneration_failed",
    );

    // Five more page loads inside the 1-minute window must not call out.
    for (let i = 0; i < 5; i += 1) {
      expect(pageLoadAttempt()).toBeNull();
    }
    expect(sdk.create).toHaveBeenCalledTimes(1);

    // 1-minute retry window elapsed → one attempt is allowed again.
    vi.setSystemTime(new Date(start.getTime() + 60_001));
    sdk.create.mockRejectedValueOnce(apiError(500));
    const second = pageLoadAttempt();
    expect(second).not.toBeNull();
    await insights.regenerateInsight(1, "sk-ant-test", second!);
    expect(sdk.create).toHaveBeenCalledTimes(2);

    // Second consecutive failure widens the backoff to 5 minutes.
    vi.setSystemTime(new Date(start.getTime() + 60_001 + 4 * 60_000));
    expect(pageLoadAttempt()).toBeNull();
    expect(sdk.create).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date(start.getTime() + 60_001 + 5 * 60_000 + 1));
    expect(pageLoadAttempt()).not.toBeNull();
  });

  it("stops calling out after Anthropic rejects the key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00.000Z"));

    const connection = await import("./db/connection");
    const writer = connection.openWrite();
    writer!
      .prepare(
        "INSERT INTO recovery (user_id, date, recovery_score) VALUES (1, '2026-11-10', 70)",
      )
      .run();
    writer!.close();

    await load();

    sdk.create.mockRejectedValueOnce(apiError(401));
    const status = insights.getInsightStatus(1, true);
    const lock = insights.acquireInsightRegenerationLock(1, status, "sk-ant-bad");
    expect(lock).not.toBeNull();
    await insights.regenerateInsight(1, "sk-ant-bad", lock!);

    expect(db.getAnthropicKeyRejectedAt(1)).toEqual(expect.any(String));

    vi.setSystemTime(new Date("2026-11-11T12:00:00.000Z"));
    const nextStatus = insights.getInsightStatus(1, true);
    expect(nextStatus.keyRejected).toBe(true);
    expect(nextStatus.canAttempt).toBe(false);
    expect(
      insights.acquireInsightRegenerationLock(1, nextStatus, "sk-ant-bad"),
    ).toBeNull();

    // Replacing the key clears the marker.
    userSettings.clearAnthropicKeyRejected(1);
    expect(db.getAnthropicKeyRejectedAt(1)).toBeNull();
  });
});

describe("insight timezone staleness (issue #588)", () => {
  it("uses the user's stored timezone for the day boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T02:30:00.000Z"));

    const connection = await import("./db/connection");
    const writer = connection.openWrite();
    writer!
      .prepare(
        "INSERT INTO recovery (user_id, date, recovery_score) VALUES (1, '2026-11-09', 70)",
      )
      .run();
    writer!.close();

    await load();
    userSettings.upsertUserSettings({
      user_id: 1,
      tz: "America/Los_Angeles",
    });
    db.saveInsight(1, "2026-11-09", "yesterday locally");

    // 02:30Z is still 2026-11-09 in Los Angeles, so the insight is current.
    expect(insights.getInsightStatus(1, true).isStale).toBe(false);

    // 08:30Z crosses local midnight in Los Angeles → 2026-11-10.
    vi.setSystemTime(new Date("2026-11-10T08:30:00.000Z"));
    expect(insights.getInsightStatus(1, true).isStale).toBe(true);

    // Same instant is already 2026-11-10 in UTC, confirming the check
    // follows the stored timezone rather than the server/UTC day.
    expect(insights.userToday(1, new Date("2026-11-10T02:30:00.000Z"))).toBe(
      "2026-11-09",
    );
    userSettings.upsertUserSettings({ user_id: 1, tz: "Asia/Tokyo" });
    expect(insights.userToday(1, new Date("2026-11-10T02:30:00.000Z"))).toBe(
      "2026-11-10",
    );
  });
});
