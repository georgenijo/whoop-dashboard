import "server-only";
import { hasTable, openWrite, safeQuery } from "./connection";

// Status values stored in webhook_events.status:
//   pending    — row inserted, handler not yet completed
//   succeeded  — handler ran cleanly
//   failed     — handler threw something non-Whoop-404; replayable
//   discarded  — Whoop responded 404 (resource gone); not replayable
export type WebhookEventStatus = "pending" | "succeeded" | "failed" | "discarded";

export type WebhookEventRow = {
  id: number;
  received_at: string;
  event_type: string;
  resource_id: string;
  trace_id: string | null;
  payload: string;
  attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
  status: WebhookEventStatus;
};

export type InsertWebhookEventInput = {
  received_at: string;
  event_type: string;
  resource_id: string;
  trace_id?: string | null;
  payload: string;
  // attempts starts at 1 — the row is created at the moment of the first
  // dispatch. Replays bump this via markWebhook* helpers.
  attempts?: number;
  last_attempt_at?: string | null;
};

const ERROR_TRUNCATE = 800;

/** Insert a new webhook event row in `pending` state. Returns the row id, or null
 * if the DB is unreachable (caller decides whether to fail open or closed). */
export function insertWebhookEvent(input: InsertWebhookEventInput): number | null {
  const db = openWrite();
  if (!db) return null;
  try {
    const info = db
      .prepare(
        `INSERT INTO webhook_events (
          received_at, event_type, resource_id, trace_id, payload,
          attempts, last_attempt_at, last_error, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'pending')`
      )
      .run(
        input.received_at,
        input.event_type,
        input.resource_id,
        input.trace_id ?? null,
        input.payload,
        input.attempts ?? 1,
        input.last_attempt_at ?? null
      );
    return Number(info.lastInsertRowid);
  } finally {
    db.close();
  }
}

export function markWebhookSucceeded(id: number, attemptedAt: string): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      `UPDATE webhook_events
       SET status = 'succeeded', last_error = NULL, last_attempt_at = ?
       WHERE id = ?`
    ).run(attemptedAt, id);
  } finally {
    db.close();
  }
}

export function markWebhookFailed(id: number, error: string, attemptedAt: string): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      `UPDATE webhook_events
       SET status = 'failed', last_error = ?, last_attempt_at = ?
       WHERE id = ?`
    ).run(error.slice(0, ERROR_TRUNCATE), attemptedAt, id);
  } finally {
    db.close();
  }
}

export function markWebhookDiscarded(id: number, attemptedAt: string): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      `UPDATE webhook_events
       SET status = 'discarded', last_error = NULL, last_attempt_at = ?
       WHERE id = ?`
    ).run(attemptedAt, id);
  } finally {
    db.close();
  }
}

export function bumpWebhookAttempt(id: number, attemptedAt: string): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      `UPDATE webhook_events
       SET attempts = attempts + 1, last_attempt_at = ?
       WHERE id = ?`
    ).run(attemptedAt, id);
  } finally {
    db.close();
  }
}

export function getWebhookEvent(id: number): WebhookEventRow | null {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "webhook_events")) return null;
      const row = db
        .prepare(
          `SELECT id, received_at, event_type, resource_id, trace_id, payload,
                  attempts, last_attempt_at, last_error, status
           FROM webhook_events WHERE id = ?`
        )
        .get(id) as WebhookEventRow | undefined;
      return row ?? null;
    }) ?? null
  );
}

export function listFailedWebhookEvents(limit = 20): WebhookEventRow[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "webhook_events")) return [] as WebhookEventRow[];
      return db
        .prepare(
          `SELECT id, received_at, event_type, resource_id, trace_id, payload,
                  attempts, last_attempt_at, last_error, status
           FROM webhook_events
           WHERE status = 'failed'
           ORDER BY id DESC
           LIMIT ?`
        )
        .all(limit) as WebhookEventRow[];
    }) ?? []
  );
}
