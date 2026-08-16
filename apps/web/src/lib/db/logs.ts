import "server-only";
import { existsSync } from "node:fs";
import Database, { type Database as DB } from "better-sqlite3";
import {
  dbPath,
  hasColumn,
  hasTable,
  migrateRouteLogsSchema,
  openWrite,
  safeQuery,
} from "./connection";

let routeLogsSchemaReady = false;

/**
 * Opens its own raw better-sqlite3 connection instead of going through
 * openWrite() — deliberately, not by accident. See migrateRouteLogsSchema()'s
 * doc comment in connection.ts (issue #505) for the full cost rationale:
 * route_logs is written on every page render, and openWrite() re-derives the
 * whole app's schema state on every call with no caching, so routing this
 * hot path through it would be a real, measured per-request tax. The
 * `routeLogsSchemaReady` flag below makes the migration a one-time cost per
 * process instead.
 */
function openRouteLogWrite(): DB | null {
  const p = dbPath();
  if (!existsSync(p)) return null;
  try {
    const db = new Database(p, { fileMustExist: true });
    try {
      db.pragma("journal_mode = WAL");
      if (!routeLogsSchemaReady) {
        if (!hasTable(db, "users")) {
          // Issue #505 edge case: nothing has ever called openWrite() against
          // this DB file, so `users` doesn't exist yet and
          // migrateRouteLogsSchema()'s user_id step (SELECT id FROM users)
          // would throw. That throw used to be swallowed by the catch below,
          // silently dropping the log line and leaving route_logs created
          // without user_id until the next openWrite() call.
          //
          // Rather than duplicate app-wide bootstrap here, delegate this
          // one-time case to the real thing: openWrite() creates `users` and
          // migrates every table, including route_logs, in one shot. This
          // only runs once per process (routeLogsSchemaReady latches true
          // right after), so it doesn't reintroduce the per-request cost
          // this function exists to avoid.
          db.close();
          const bootstrapped = openWrite();
          if (!bootstrapped) return null;
          bootstrapped.close();
          const reopened = new Database(p, { fileMustExist: true });
          try {
            reopened.pragma("journal_mode = WAL");
          } catch {
            // `db` (the outer try's connection) is already closed above —
            // closing it again here would be a no-op on the wrong handle.
            // `reopened` is the live connection that needs cleanup.
            reopened.close();
            return null;
          }
          routeLogsSchemaReady = true;
          return reopened;
        }
        migrateRouteLogsSchema(db);
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
  /** Owning tenant. Nullable because rows written before the #499 migration
   *  pre-date this column and can't be given a NOT NULL value at ALTER time
   *  (issue #499, same shape as chat_logs/sync_logs — see #494). Reads
   *  filter strictly on `user_id = ?`, so a NULL row is invisible to every
   *  tenant rather than being backfilled onto whoever happens to be user 1. */
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
