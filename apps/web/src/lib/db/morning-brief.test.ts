// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildMorningBrief,
  MORNING_METRIC_KEYS,
  normalizedEmailSha256,
  type MorningAccountBinding,
} from "./morning-brief";

const tmpRoot = mkdtempSync(path.join(tmpdir(), "frame-morning-brief-"));
let dbFile: string;

const NOW = new Date("2026-10-19T03:30:00.000Z");
const SUBJECT_BINDING = { kind: "account_subject", value: "owner-sub" } as const;

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      apple_sub TEXT,
      email TEXT,
      timezone TEXT
    );
    CREATE TABLE integrations (
      user_id INTEGER,
      provider TEXT,
      needs_reauth INTEGER,
      provider_user_id TEXT,
      updated_at TEXT,
      PRIMARY KEY (user_id, provider)
    );
    CREATE TABLE recovery (
      user_id INTEGER,
      date TEXT,
      recovery_score REAL,
      hrv REAL,
      rhr REAL,
      raw JSON,
      PRIMARY KEY (user_id, date)
    );
    CREATE TABLE sleep (
      user_id INTEGER,
      sleep_id TEXT,
      date TEXT,
      in_bed_ms INTEGER,
      light_ms INTEGER,
      deep_ms INTEGER,
      rem_ms INTEGER,
      performance REAL,
      nap INTEGER,
      raw JSON,
      PRIMARY KEY (user_id, sleep_id)
    );
    CREATE TABLE cycles (
      user_id INTEGER,
      date TEXT,
      strain REAL,
      raw JSON,
      PRIMARY KEY (user_id, date)
    );
    CREATE TABLE daily_steps (
      user_id INTEGER,
      date TEXT,
      steps INTEGER,
      source TEXT,
      updated_at TEXT,
      PRIMARY KEY (user_id, date)
    );
    CREATE TABLE whoop_cycle_steps (
      user_id INTEGER,
      cycle_id INTEGER,
      date TEXT,
      cycle_start TEXT,
      cycle_end TEXT,
      step_count INTEGER,
      upstream_updated_at TEXT,
      fetched_at TEXT,
      PRIMARY KEY (user_id, cycle_id)
    );
  `);
}

function seedAccounts(db: Database.Database): void {
  db.prepare("INSERT INTO users VALUES (?, ?, ?, ?)").run(
    1,
    "other-sub",
    "other@example.com",
    "America/Los_Angeles",
  );
  db.prepare("INSERT INTO users VALUES (?, ?, ?, ?)").run(
    2,
    "owner-sub",
    "owner@example.com",
    "America/New_York",
  );
  db.prepare("INSERT INTO integrations VALUES (?, 'whoop', 0, ?, ?)").run(
    2,
    "provider-owner",
    "2026-10-18 22:00:00",
  );
}

function raw(fields: Record<string, string>): string {
  return JSON.stringify({ ...fields, ignored_health_record: { value: 999 } });
}

function seedCompleteDay(db: Database.Database): void {
  db.prepare("INSERT INTO recovery VALUES (?, ?, ?, ?, ?, ?)").run(
    1,
    "2026-10-18",
    99,
    199,
    39,
    raw({ updated_at: "2026-10-18T12:00:00Z" }),
  );
  db.prepare("INSERT INTO recovery VALUES (?, ?, ?, ?, ?, ?)").run(
    2,
    "2026-10-18",
    72,
    64.5,
    52,
    raw({ updated_at: "2026-10-18 13:01:02" }),
  );
  db.prepare("INSERT INTO sleep VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)").run(
    2,
    "sleep-owner",
    "2026-10-18",
    27_000_000,
    14_400_000,
    5_400_000,
    3_600_000,
    88,
    raw({
      start: "2026-10-18T03:30:00-04:00",
      end: "2026-10-18T10:30:00-04:00",
      updated_at: "2026-10-18T14:35:00Z",
    }),
  );
  db.prepare("INSERT INTO cycles VALUES (?, ?, ?, ?)").run(
    2,
    "2026-10-18",
    12.4,
    raw({
      start: "2026-10-18T10:30:00-04:00",
      end: "2026-10-19T03:00:00Z",
      updated_at: "2026-10-19T03:05:00Z",
    }),
  );
  db.prepare("INSERT INTO daily_steps VALUES (?, ?, ?, 'apple_health', ?)").run(
    2,
    "2026-10-18",
    9_000,
    "2026-10-18 22:15:00",
  );
  db.prepare("INSERT INTO whoop_cycle_steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    2,
    2002,
    "2026-10-18",
    "2026-10-18T10:30:00-04:00",
    "2026-10-19T03:00:00Z",
    8_123,
    "2026-10-19T03:05:00Z",
    "2026-10-19 03:06:00",
  );
}

beforeEach(() => {
  dbFile = path.join(tmpRoot, `${Math.random().toString(36).slice(2)}.db`);
  process.env.WHOOP_DB_PATH = dbFile;
  const db = new Database(dbFile);
  createSchema(db);
  seedAccounts(db);
  db.close();
});

afterAll(() => {
  delete process.env.WHOOP_DB_PATH;
  rmSync(tmpRoot, { recursive: true, force: true });
});

function build(binding: MorningAccountBinding = SUBJECT_BINDING) {
  return buildMorningBrief({ userId: 2, binding, now: NOW });
}

function expectUnavailable(result: ReturnType<typeof buildMorningBrief>): void {
  expect(result.brief.status).toBe("unavailable");
  for (const key of MORNING_METRIC_KEYS) {
    expect(result.brief.metrics[key]).toMatchObject({
      value: null,
      source: null,
      status: "unavailable",
      partial: false,
    });
  }
}

describe("buildMorningBrief", () => {
  it("builds the v1 payload for one explicitly bound tenant", () => {
    const db = new Database(dbFile);
    seedCompleteDay(db);
    db.close();

    const result = build();
    expect(result.failure).toBeNull();
    expect(result.brief).toMatchObject({
      schema_version: 1,
      generated_at: "2026-10-19T03:30:00.000Z",
      expires_at: "2026-10-19T03:40:00.000Z",
      timezone: "America/New_York",
      requested_date: "2026-10-18",
      status: "ok",
    });
    expect(result.brief.metrics.sleep_duration).toMatchObject({
      value: 6.5,
      unit: "h",
      source: "whoop",
      period_start: "2026-10-18T07:30:00.000Z",
      period_end: "2026-10-18T14:30:00.000Z",
      source_updated_at: "2026-10-18T14:35:00.000Z",
      status: "available",
    });
    expect(result.brief.metrics.recovery_score.value).toBe(72);
    expect(result.brief.metrics.recovery_score.source_updated_at).toBe(
      "2026-10-18T13:01:02.000Z",
    );
    expect(result.brief.metrics.steps).toMatchObject({
      value: 8_123,
      source: "whoop",
      period_start: "2026-10-18T14:30:00.000Z",
      ingested_at: "2026-10-19T03:06:00.000Z",
      partial: false,
    });
    expect(JSON.stringify(result.brief)).not.toContain("ignored_health_record");
    expect(JSON.stringify(result.brief)).not.toContain("other@example.com");
  });

  it("selects each metric independently and preserves null, fallback, stale, and provider priority", () => {
    const db = new Database(dbFile);
    db.prepare("INSERT INTO recovery VALUES (2, ?, NULL, ?, ?, ?)").run(
      "2026-10-18",
      61,
      10,
      raw({ updated_at: "2026-10-18T16:00:00Z" }),
    );
    db.prepare("INSERT INTO recovery VALUES (2, ?, ?, ?, ?, ?)").run(
      "2026-10-17",
      65,
      59,
      54,
      raw({ updated_at: "2026-10-17T15:00:00Z" }),
    );
    db.prepare("INSERT INTO sleep VALUES (2, 'current', ?, ?, ?, NULL, ?, ?, 0, ?)").run(
      "2026-10-18",
      25_000_000,
      14_000_000,
      4_000_000,
      84,
      raw({ updated_at: "2026-10-18T14:00:00Z" }),
    );
    db.prepare("INSERT INTO sleep VALUES (2, 'prior', ?, ?, ?, ?, ?, ?, 0, ?)").run(
      "2026-10-17",
      25_000_000,
      14_000_000,
      5_000_000,
      3_000_000,
      82,
      raw({ updated_at: "2026-10-17T14:00:00Z" }),
    );
    db.prepare("INSERT INTO cycles VALUES (2, ?, ?, ?)").run(
      "2026-10-16",
      10.2,
      raw({ updated_at: "2026-10-16T23:00:00Z" }),
    );
    db.prepare("INSERT INTO whoop_cycle_steps VALUES (2, 1, ?, ?, NULL, NULL, ?, ?)").run(
      "2026-10-18",
      "2026-10-18T12:00:00Z",
      "2026-10-18T15:00:00Z",
      "2026-10-18T15:01:00Z",
    );
    db.prepare("INSERT INTO daily_steps VALUES (2, ?, ?, 'apple_health', ?)").run(
      "2026-10-18",
      4_567,
      "2026-10-18 22:15:00",
    );
    db.close();

    const result = build();
    expect(result.brief.status).toBe("partial");
    expect(result.brief.metrics.recovery_score).toMatchObject({ value: 65, status: "stale" });
    expect(result.brief.metrics.hrv).toMatchObject({ value: 61, status: "available" });
    expect(result.brief.metrics.resting_heart_rate).toMatchObject({ value: 54, status: "stale" });
    expect(result.brief.metrics.sleep_duration).toMatchObject({ value: 22 / 3.6, status: "stale" });
    expect(result.brief.metrics.sleep_performance).toMatchObject({ value: 84, status: "available" });
    expect(result.brief.metrics.strain).toMatchObject({ value: 10.2, status: "stale" });
    expect(result.brief.metrics.steps).toMatchObject({
      value: 4_567,
      source: "apple_health",
      status: "available",
      partial: false,
    });
  });

  it("uses the latest dated provider without summing and marks an open WHOOP cycle partial", () => {
    const db = new Database(dbFile);
    db.prepare("INSERT INTO whoop_cycle_steps VALUES (2, 2, ?, ?, NULL, ?, ?, ?)").run(
      "2026-10-17",
      "2026-10-17T12:00:00Z",
      3_210,
      "2026-10-18T01:00:00Z",
      "2026-10-18T01:01:00Z",
    );
    db.prepare("INSERT INTO daily_steps VALUES (2, ?, ?, 'apple_health', ?)").run(
      "2026-10-16",
      7_654,
      "2026-10-17T01:00:00Z",
    );
    db.close();

    expect(build().brief.metrics.steps).toMatchObject({
      value: 3_210,
      source: "whoop",
      status: "stale",
      partial: true,
    });
  });

  it("does not use future, out-of-range, non-integer, or over-bound values", () => {
    const db = new Database(dbFile);
    db.prepare("INSERT INTO recovery VALUES (2, '2026-10-10', 50, 50, 50, NULL)").run();
    db.prepare("INSERT INTO cycles VALUES (2, '2026-10-19', 9, NULL)").run();
    db.prepare("INSERT INTO daily_steps VALUES (2, '2026-10-18', 200001, 'apple_health', ?)").run(
      "2026-10-18T12:00:00Z",
    );
    db.prepare("INSERT INTO whoop_cycle_steps VALUES (2, 9, '2026-10-18', ?, NULL, 123.5, ?, ?)").run(
      "2026-10-18T12:00:00Z",
      "2026-10-18T13:00:00Z",
      "2026-10-18T13:01:00Z",
    );
    db.close();

    const metrics = build().brief.metrics;
    expect(metrics.recovery_score.status).toBe("missing");
    expect(metrics.recovery_score.value).toBeNull();
    expect(metrics.strain.status).toBe("missing");
    expect(metrics.steps.status).toBe("missing");
  });

  it("supports a unique normalized email hash binding", () => {
    const db = new Database(dbFile);
    seedCompleteDay(db);
    db.close();
    const result = build({
      kind: "email_sha256",
      value: normalizedEmailSha256(" OWNER@example.com "),
    });
    expect(result.failure).toBeNull();
    expect(result.brief.status).toBe("ok");
  });

  it("fails closed for a mismatched tenant instead of selecting the first user", () => {
    const result = build({ kind: "account_subject", value: "other-sub" });
    expect(result.failure).toBe("account_unavailable");
    expectUnavailable(result);
  });

  it("fails closed after account deletion", () => {
    const db = new Database(dbFile);
    db.prepare("DELETE FROM users WHERE id = 2").run();
    db.close();
    const result = build();
    expect(result.failure).toBe("account_unavailable");
    expectUnavailable(result);
  });

  it("fails closed after integration revocation or removal", () => {
    const db = new Database(dbFile);
    db.prepare("UPDATE integrations SET needs_reauth = 1 WHERE user_id = 2").run();
    db.close();
    const revoked = build();
    expect(revoked.failure).toBe("integration_unavailable");
    expect(revoked.brief.timezone).toBe("America/New_York");
    expectUnavailable(revoked);

    const db2 = new Database(dbFile);
    db2.prepare("DELETE FROM integrations WHERE user_id = 2").run();
    db2.close();
    const removed = build();
    expect(removed.failure).toBe("integration_unavailable");
    expectUnavailable(removed);
  });

  it("fails closed on schema drift", () => {
    const db = new Database(dbFile);
    db.exec("DROP TABLE cycles");
    db.close();
    const result = build();
    expect(result.failure).toBe("schema_invalid");
    expectUnavailable(result);
  });
});
