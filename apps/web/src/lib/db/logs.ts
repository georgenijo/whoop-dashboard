import "server-only";
import { existsSync } from "node:fs";
import Database, { type Database as DB } from "better-sqlite3";
import {
  addUserIdColumnAndClaimLegacyRows,
  dbPath,
  hasColumn,
  hasTable,
  openWrite,
  safeQuery,
} from "./connection";

let routeLogsSchemaReady = false;

function openRouteLogWrite(): DB | null {
  const p = dbPath();
  if (!existsSync(p)) return null;
  try {
    const db = new Database(p, { fileMustExist: true });
    try {
      db.pragma("journal_mode = WAL");
      if (!routeLogsSchemaReady) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS route_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT NOT NULL,
            route TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            status INTEGER NOT NULL,
            details TEXT,
            response_bytes INTEGER,
            render_ms INTEGER
          );
          CREATE INDEX IF NOT EXISTS route_logs_started_at_idx ON route_logs(started_at DESC);
        `);
        const cols = db.prepare("PRAGMA table_info(route_logs)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "details")) {
          db.exec("ALTER TABLE route_logs ADD COLUMN details TEXT");
        }
        // Issue #296 — keep in sync with the canonical migration in connection.ts.
        if (!cols.some((c) => c.name === "response_bytes")) {
          db.exec("ALTER TABLE route_logs ADD COLUMN response_bytes INTEGER");
        }
        if (!cols.some((c) => c.name === "render_ms")) {
          db.exec("ALTER TABLE route_logs ADD COLUMN render_ms INTEGER");
        }
        // Issue #499 — keep in sync with the canonical migration in
        // connection.ts. route_logs is bootstrapped in BOTH places (this
        // function opens its own raw connection instead of going through
        // openWrite()), so whichever runs first must leave the schema
        // identical to the other, or the shape depends on request ordering.
        if (!cols.some((c) => c.name === "user_id")) {
          addUserIdColumnAndClaimLegacyRows(db, "route_logs");
        }
        db.exec("CREATE INDEX IF NOT EXISTS idx_route_logs_user ON route_logs(user_id, id DESC)");
        routeLogsSchemaReady = true;
      }
      return db;
    } catch {
      db.close();
      return null;
    }
  } catch {
    return null;
  }
}

export type ChatLog = {
  id: number;
  /** Owning tenant. NULL only on legacy rows written before issue #494 that
   *  the single-user backfill in `openWrite()` could not claim (i.e. the DB
   *  already had more than one account). Those rows are unreadable by design
   *  — every read filters on `user_id = ?`. */
  user_id: number | null;
  started_at: string;
  prompt_preview: string;
  duration_ms: number;
  status: "ok" | "error" | "aborted";
  response_length: number;
  error_message: string | null;
  days_context: number | null;
  type: "cli" | "api" | null;
  source: "web" | "ios" | null;
  details?: string | null;
  thread_id: number | null;
};

/** `user_id` is a required field of the payload (not an optional trailing
 *  argument) so a caller that forgets to stamp the tenant fails typecheck
 *  instead of silently writing an orphaned, unreadable row. */
export function addChatLog(log: Omit<ChatLog, "id"> & { user_id: number }): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      "INSERT INTO chat_logs (user_id, started_at, prompt_preview, duration_ms, status, response_length, error_message, days_context, type, source, details, thread_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      log.user_id,
      log.started_at,
      log.prompt_preview,
      log.duration_ms,
      log.status,
      log.response_length,
      log.error_message,
      log.days_context,
      log.type,
      log.source,
      log.details ?? null,
      log.thread_id ?? null
    );
  } finally {
    db.close();
  }
}

/** Tenant-scoped. `userId` is the first, required argument — omitting it is a
 *  type error rather than a silent cross-tenant read (issue #494). */
export function getChatLogs(userId: number, limit = 200): ChatLog[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "chat_logs")) return [] as ChatLog[];
      // Fail closed: a DB whose schema migration hasn't run yet (read-only
      // handle, no write since deploy) has no user_id column and therefore no
      // way to tell tenants apart. Return nothing rather than everything.
      if (!hasColumn(db, "chat_logs", "user_id")) return [] as ChatLog[];
      const sourceSelect = hasColumn(db, "chat_logs", "source")
        ? "source"
        : "NULL AS source";
      const threadSelect = hasColumn(db, "chat_logs", "thread_id")
        ? "thread_id"
        : "NULL AS thread_id";
      return db
        .prepare(
          `SELECT id, user_id, started_at, prompt_preview, duration_ms, status, response_length, error_message, days_context, type, ${sourceSelect}, details, ${threadSelect} FROM chat_logs WHERE user_id = ? ORDER BY id DESC LIMIT ?`
        )
        .all(userId, limit) as ChatLog[];
    }) ?? []
  );
}

export type ChatThreadInfo = {
  id: number;
  title: string | null;
  first_user_message: string | null;
};

export function getChatThreadInfo(threadIds: number[]): Map<number, ChatThreadInfo> {
  const result = new Map<number, ChatThreadInfo>();
  if (threadIds.length === 0) return result;
  const rows =
    safeQuery((db) => {
      if (!hasTable(db, "chat_threads")) return [] as ChatThreadInfo[];
      const placeholders = threadIds.map(() => "?").join(",");
      const hasMessages = hasTable(db, "chat_messages");
      const firstUserSelect = hasMessages
        ? `(SELECT content FROM chat_messages WHERE thread_id = t.id AND role = 'user' ORDER BY id ASC LIMIT 1) AS first_user_message`
        : `NULL AS first_user_message`;
      return db
        .prepare(
          `SELECT t.id, t.title, ${firstUserSelect} FROM chat_threads t WHERE t.id IN (${placeholders})`
        )
        .all(...threadIds) as ChatThreadInfo[];
    }) ?? [];
  for (const row of rows) {
    result.set(row.id, row);
  }
  return result;
}

/** Clears only the caller's rows. A user must not be able to wipe another
 *  tenant's chat history (or the un-owned legacy rows). */
export function clearChatLogs(userId: number): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare("DELETE FROM chat_logs WHERE user_id = ?").run(userId);
  } finally {
    db.close();
  }
}

export type SyncLog = {
  id: number;
  /** Owning tenant. NULL is legitimate here (unlike chat_logs): a webhook
   *  delivery that fails signature/JSON parsing, or arrives for a Whoop
   *  account we have no local mapping for, has no tenant to attribute. Such
   *  rows are invisible to every user's /logs and — deliberately — to every
   *  user's sync-cooldown gate. */
  user_id: number | null;
  started_at: string;
  duration_ms: number;
  status: "ok" | "error";
  recovery_count: number | null;
  sleep_count: number | null;
  workouts_count: number | null;
  error_message: string | null;
  source: string | null;
  details?: string | null;
  partial: boolean;
};

/** `user_id` is a required field of the payload — pass an explicit `null` only
 *  when the sync genuinely has no owner (unattributable webhook delivery). */
export function addSyncLog(log: Omit<SyncLog, "id">): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      "INSERT INTO sync_logs (user_id, started_at, duration_ms, status, recovery_count, sleep_count, workouts_count, error_message, source, details, partial) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      log.user_id,
      log.started_at,
      log.duration_ms,
      log.status,
      log.recovery_count,
      log.sleep_count,
      log.workouts_count,
      log.error_message,
      log.source,
      log.details ?? null,
      log.partial ? 1 : 0
    );
  } finally {
    db.close();
  }
}

/** Tenant-scoped. `userId` is the first, required argument (issue #494). */
export function getSyncLogs(userId: number, limit = 200): SyncLog[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "sync_logs")) return [] as SyncLog[];
      // Fail closed — see getChatLogs.
      if (!hasColumn(db, "sync_logs", "user_id")) return [] as SyncLog[];
      const detailsSelect = hasColumn(db, "sync_logs", "details")
        ? "details"
        : "NULL AS details";
      const partialSelect = hasColumn(db, "sync_logs", "partial")
        ? "partial"
        : "0 AS partial";
      const rows = db
        .prepare(
          `SELECT id, user_id, started_at, duration_ms, status, recovery_count, sleep_count, workouts_count, error_message, source, ${detailsSelect}, ${partialSelect} FROM sync_logs WHERE user_id = ? ORDER BY id DESC LIMIT ?`
        )
        .all(userId, limit) as Array<Omit<SyncLog, "partial"> & { partial: number }>;
      return rows.map((r) => ({ ...r, partial: r.partial === 1 }));
    }) ?? []
  );
}

/**
 * Timestamp of `userId`'s most recent successful sync, or null.
 *
 * Per-user by construction (issue #494). This drives the sync-cooldown gate in
 * `/api/sync` and the coach's `trigger_whoop_sync` tool, so a global read did
 * two wrong things at once: it disclosed another tenant's last-sync time, and
 * it let one tenant's sync suppress everyone else's for the cooldown window.
 *
 * Missing `user_id` column ⇒ null, i.e. the gate opens and a sync is allowed.
 * That's the safe direction to fail: an extra sync costs an API call, whereas
 * falling back to a global row would resurrect the leak.
 */
export function getLastSuccessfulSyncAt(userId: number): Date | null {
  return safeQuery((db) => {
    if (!hasTable(db, "sync_logs")) return null;
    if (!hasColumn(db, "sync_logs", "user_id")) return null;
    const row = db
      .prepare(
        "SELECT started_at FROM sync_logs WHERE status = 'ok' AND user_id = ? ORDER BY id DESC LIMIT 1"
      )
      .get(userId) as { started_at: string } | undefined;
    return row ? new Date(row.started_at) : null;
  });
}

export type RouteLog = {
  id: number;
  /** Owning tenant. NULL for requests with no authenticated user — an
   *  unauthenticated /signin visit, /api/health, or a Whoop webhook POST
   *  never resolves to a local user, so those rows are written with
   *  user_id = NULL rather than backfilled onto any account (issue #499,
   *  same policy as sync_logs — see addSyncLog's user_id doc). Reads filter
   *  strictly on `user_id = ?`, so a NULL row is invisible to every tenant. */
  user_id: number | null;
  started_at: string;
  route: string;
  duration_ms: number;
  status: number;
  details?: string | null;
  /** Bytes in the response body. Currently always NULL — Next.js 16's
   *  `after()` callback fires post-response with no handle on the rendered
   *  HTML size. */
  response_bytes?: number | null;
  render_ms?: number | null;
};

/** `user_id` is a required field of the payload (not an optional trailing
 *  argument) — pass an explicit `null` only when there is genuinely no
 *  authenticated user for this request (issue #499, same shape as
 *  addSyncLog). */
export function addRouteLog(log: Omit<RouteLog, "id">): void {
  const db = openRouteLogWrite();
  if (!db) return;
  try {
    db.prepare(
      "INSERT INTO route_logs (user_id, started_at, route, duration_ms, status, details, response_bytes, render_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      log.user_id,
      log.started_at,
      log.route,
      log.duration_ms,
      log.status,
      log.details ?? null,
      log.response_bytes ?? null,
      log.render_ms ?? null,
    );
  } finally {
    db.close();
  }
}

/** Tenant-scoped. `userId` is the first, required argument — omitting it is a
 *  type error rather than a silent cross-tenant read (issue #499, mirrors
 *  getChatLogs/getSyncLogs from #494). */
export function getRouteLogs(userId: number, limit = 200): RouteLog[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "route_logs")) return [] as RouteLog[];
      // Fail closed: a DB whose schema migration hasn't run yet (read-only
      // handle, no write since deploy) has no user_id column and therefore no
      // way to tell tenants apart. Return nothing rather than everything.
      if (!hasColumn(db, "route_logs", "user_id")) return [] as RouteLog[];
      const detailsSelect = hasColumn(db, "route_logs", "details")
        ? "details"
        : "NULL AS details";
      const responseBytesSelect = hasColumn(db, "route_logs", "response_bytes")
        ? "response_bytes"
        : "NULL AS response_bytes";
      const renderMsSelect = hasColumn(db, "route_logs", "render_ms")
        ? "render_ms"
        : "NULL AS render_ms";
      return db
        .prepare(
          `SELECT id, user_id, started_at, route, duration_ms, status, ${detailsSelect}, ${responseBytesSelect}, ${renderMsSelect} FROM route_logs WHERE user_id = ? ORDER BY started_at DESC, id DESC LIMIT ?`
        )
        .all(userId, limit) as RouteLog[];
    }) ?? []
  );
}
