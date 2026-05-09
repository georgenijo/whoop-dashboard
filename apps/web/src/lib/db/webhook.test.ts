import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// WHOOP_DB_PATH must be set before importing the module under test —
// connection.ts reads it via dbPath() which lazy-creates the schema on first
// openWrite(). Mirrors the pattern in users.test.ts.
const tmpRoot = mkdtempSync(path.join(tmpdir(), "webhook-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;

// better-sqlite3 needs the file to exist (fileMustExist: true). Touch it.
writeFileSync(dbFile, "");

type WebhookModule = typeof import("./webhook");
type ConnectionModule = typeof import("./connection");
let webhook: WebhookModule;
let connection: ConnectionModule;

function listWebhookColumns(): string[] {
  const db = new Database(dbFile);
  try {
    const cols = db.prepare("PRAGMA table_info(webhook_events)").all() as { name: string }[];
    return cols.map((c) => c.name);
  } finally {
    db.close();
  }
}

function readRow(id: number) {
  const db = new Database(dbFile);
  try {
    return db
      .prepare(
        `SELECT id, received_at, event_type, resource_id, trace_id, payload,
                attempts, last_attempt_at, last_error, status
         FROM webhook_events WHERE id = ?`
      )
      .get(id) as
      | {
          id: number;
          received_at: string;
          event_type: string;
          resource_id: string;
          trace_id: string | null;
          payload: string;
          attempts: number;
          last_attempt_at: string | null;
          last_error: string | null;
          status: string;
        }
      | undefined;
  } finally {
    db.close();
  }
}

function clearWebhookEvents(): void {
  const db = new Database(dbFile);
  try {
    db.prepare("DELETE FROM webhook_events").run();
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  connection = await import("./connection");
  webhook = await import("./webhook");
  // First write triggers schema creation, including the new webhook_events table.
  const db = connection.openWrite();
  db?.close();
});

beforeEach(() => {
  clearWebhookEvents();
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("webhook_events schema", () => {
  it("creates the table with the expected columns on first openWrite()", () => {
    const cols = listWebhookColumns();
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "received_at",
        "event_type",
        "resource_id",
        "trace_id",
        "payload",
        "attempts",
        "last_attempt_at",
        "last_error",
        "status",
      ])
    );
  });

  it("creates the supporting indexes", () => {
    const db = new Database(dbFile);
    try {
      const idx = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='webhook_events'"
        )
        .all() as { name: string }[];
      const names = idx.map((r) => r.name);
      expect(names).toContain("idx_webhook_events_status");
      expect(names).toContain("idx_webhook_events_received_at");
    } finally {
      db.close();
    }
  });
});

describe("insertWebhookEvent", () => {
  it("inserts a pending row with the supplied fields and returns its id", () => {
    const id = webhook.insertWebhookEvent({
      received_at: "2026-05-09T12:00:00.000Z",
      event_type: "sleep.updated",
      resource_id: "sleep-abc",
      trace_id: "trace-xyz",
      payload: '{"id":"sleep-abc","type":"sleep.updated"}',
    });
    expect(id).not.toBeNull();
    const row = readRow(id!);
    expect(row).toBeDefined();
    expect(row!.event_type).toBe("sleep.updated");
    expect(row!.resource_id).toBe("sleep-abc");
    expect(row!.trace_id).toBe("trace-xyz");
    expect(row!.status).toBe("pending");
    expect(row!.attempts).toBe(1);
    expect(row!.last_error).toBeNull();
  });

  it("defaults attempts to 1 and persists trace_id=null when omitted", () => {
    const id = webhook.insertWebhookEvent({
      received_at: "2026-05-09T12:00:00.000Z",
      event_type: "workout.updated",
      resource_id: "workout-1",
      payload: "{}",
    });
    const row = readRow(id!);
    expect(row!.attempts).toBe(1);
    expect(row!.trace_id).toBeNull();
  });
});

describe("status transitions", () => {
  it("markWebhookSucceeded clears last_error and sets status", () => {
    const id = webhook.insertWebhookEvent({
      received_at: "2026-05-09T12:00:00.000Z",
      event_type: "sleep.updated",
      resource_id: "s",
      payload: "{}",
    });
    webhook.markWebhookFailed(id!, "boom", "2026-05-09T12:00:01.000Z");
    webhook.markWebhookSucceeded(id!, "2026-05-09T12:00:02.000Z");
    const row = readRow(id!);
    expect(row!.status).toBe("succeeded");
    expect(row!.last_error).toBeNull();
    expect(row!.last_attempt_at).toBe("2026-05-09T12:00:02.000Z");
  });

  it("markWebhookFailed truncates very long errors to 800 chars", () => {
    const id = webhook.insertWebhookEvent({
      received_at: "2026-05-09T12:00:00.000Z",
      event_type: "sleep.updated",
      resource_id: "s",
      payload: "{}",
    });
    const huge = "x".repeat(2000);
    webhook.markWebhookFailed(id!, huge, "2026-05-09T12:00:01.000Z");
    const row = readRow(id!);
    expect(row!.status).toBe("failed");
    expect(row!.last_error?.length).toBe(800);
  });

  it("markWebhookDiscarded sets status without recording an error", () => {
    const id = webhook.insertWebhookEvent({
      received_at: "2026-05-09T12:00:00.000Z",
      event_type: "sleep.deleted",
      resource_id: "s",
      payload: "{}",
    });
    webhook.markWebhookDiscarded(id!, "2026-05-09T12:00:01.000Z");
    const row = readRow(id!);
    expect(row!.status).toBe("discarded");
    expect(row!.last_error).toBeNull();
  });

  it("bumpWebhookAttempt increments attempts and updates last_attempt_at", () => {
    const id = webhook.insertWebhookEvent({
      received_at: "2026-05-09T12:00:00.000Z",
      event_type: "sleep.updated",
      resource_id: "s",
      payload: "{}",
    });
    webhook.bumpWebhookAttempt(id!, "2026-05-09T12:00:01.000Z");
    webhook.bumpWebhookAttempt(id!, "2026-05-09T12:00:02.000Z");
    const row = readRow(id!);
    expect(row!.attempts).toBe(3); // 1 (insert) + 2 bumps
    expect(row!.last_attempt_at).toBe("2026-05-09T12:00:02.000Z");
  });
});

describe("getWebhookEvent / listFailedWebhookEvents", () => {
  it("returns null for a missing id", () => {
    expect(webhook.getWebhookEvent(99999)).toBeNull();
  });

  it("returns the row by id", () => {
    const id = webhook.insertWebhookEvent({
      received_at: "2026-05-09T12:00:00.000Z",
      event_type: "sleep.updated",
      resource_id: "s",
      payload: "{}",
    });
    const row = webhook.getWebhookEvent(id!);
    expect(row?.id).toBe(id);
    expect(row?.status).toBe("pending");
  });

  it("listFailedWebhookEvents returns only failed rows in id-desc order, capped by limit", () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const id = webhook.insertWebhookEvent({
        received_at: `2026-05-09T12:00:0${i}.000Z`,
        event_type: "sleep.updated",
        resource_id: `s${i}`,
        payload: "{}",
      });
      ids.push(id!);
    }
    // Mark 0,2,4 as failed; 1 succeeded; 3 discarded.
    webhook.markWebhookFailed(ids[0], "e0", "2026-05-09T12:01:00.000Z");
    webhook.markWebhookSucceeded(ids[1], "2026-05-09T12:01:00.000Z");
    webhook.markWebhookFailed(ids[2], "e2", "2026-05-09T12:01:00.000Z");
    webhook.markWebhookDiscarded(ids[3], "2026-05-09T12:01:00.000Z");
    webhook.markWebhookFailed(ids[4], "e4", "2026-05-09T12:01:00.000Z");

    const all = webhook.listFailedWebhookEvents(10);
    expect(all.map((r) => r.id)).toEqual([ids[4], ids[2], ids[0]]);

    const limited = webhook.listFailedWebhookEvents(2);
    expect(limited.map((r) => r.id)).toEqual([ids[4], ids[2]]);
  });
});
