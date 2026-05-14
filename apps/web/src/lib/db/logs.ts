import "server-only";
import { existsSync } from "node:fs";
import Database, { type Database as DB } from "better-sqlite3";
import { dbPath, hasColumn, hasTable, openWrite, safeQuery } from "./connection";

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
            server_timing TEXT,
            cache_status TEXT,
            render_ms INTEGER
          );
          CREATE INDEX IF NOT EXISTS route_logs_started_at_idx ON route_logs(started_at DESC);
        `);
        const cols = db.prepare("PRAGMA table_info(route_logs)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "details")) {
          db.exec("ALTER TABLE route_logs ADD COLUMN details TEXT");
        }
        // Issue #296 — backfilled NULL on existing rows. The page-render
        // detail UI handles NULL gracefully ("Not captured"). Keep these
        // ALTERs in sync with the canonical migration in connection.ts.
        if (!cols.some((c) => c.name === "response_bytes")) {
          db.exec("ALTER TABLE route_logs ADD COLUMN response_bytes INTEGER");
        }
        if (!cols.some((c) => c.name === "server_timing")) {
          db.exec("ALTER TABLE route_logs ADD COLUMN server_timing TEXT");
        }
        if (!cols.some((c) => c.name === "cache_status")) {
          db.exec("ALTER TABLE route_logs ADD COLUMN cache_status TEXT");
        }
        if (!cols.some((c) => c.name === "render_ms")) {
          db.exec("ALTER TABLE route_logs ADD COLUMN render_ms INTEGER");
        }
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
};

export function addChatLog(log: Omit<ChatLog, "id">): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      "INSERT INTO chat_logs (started_at, prompt_preview, duration_ms, status, response_length, error_message, days_context, type, source, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      log.started_at,
      log.prompt_preview,
      log.duration_ms,
      log.status,
      log.response_length,
      log.error_message,
      log.days_context,
      log.type,
      log.source,
      log.details ?? null
    );
  } finally {
    db.close();
  }
}

export function getChatLogs(limit = 200): ChatLog[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "chat_logs")) return [] as ChatLog[];
      const sourceSelect = hasColumn(db, "chat_logs", "source")
        ? "source"
        : "NULL AS source";
      return db
        .prepare(
          `SELECT id, started_at, prompt_preview, duration_ms, status, response_length, error_message, days_context, type, ${sourceSelect}, details FROM chat_logs ORDER BY id DESC LIMIT ?`
        )
        .all(limit) as ChatLog[];
    }) ?? []
  );
}

export function clearChatLogs(): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare("DELETE FROM chat_logs").run();
  } finally {
    db.close();
  }
}

export type SyncLog = {
  id: number;
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

export function addSyncLog(log: Omit<SyncLog, "id">): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      "INSERT INTO sync_logs (started_at, duration_ms, status, recovery_count, sleep_count, workouts_count, error_message, source, details, partial) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
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

export function getSyncLogs(limit = 200): SyncLog[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "sync_logs")) return [] as SyncLog[];
      const detailsSelect = hasColumn(db, "sync_logs", "details")
        ? "details"
        : "NULL AS details";
      const partialSelect = hasColumn(db, "sync_logs", "partial")
        ? "partial"
        : "0 AS partial";
      const rows = db
        .prepare(
          `SELECT id, started_at, duration_ms, status, recovery_count, sleep_count, workouts_count, error_message, source, ${detailsSelect}, ${partialSelect} FROM sync_logs ORDER BY id DESC LIMIT ?`
        )
        .all(limit) as Array<Omit<SyncLog, "partial"> & { partial: number }>;
      return rows.map((r) => ({ ...r, partial: r.partial === 1 }));
    }) ?? []
  );
}

export function getLastSuccessfulSyncAt(): Date | null {
  return safeQuery((db) => {
    if (!hasTable(db, "sync_logs")) return null;
    const row = db
      .prepare(
        "SELECT started_at FROM sync_logs WHERE status = 'ok' ORDER BY id DESC LIMIT 1"
      )
      .get() as { started_at: string } | undefined;
    return row ? new Date(row.started_at) : null;
  });
}

export type RouteLog = {
  id: number;
  started_at: string;
  route: string;
  duration_ms: number;
  status: number;
  details?: string | null;
  /** Bytes in the response body. Currently always NULL — Next.js 16's
   *  `after()` callback fires post-response with no clean handle on the
   *  rendered HTML size; documented as a trim in the PR. */
  response_bytes?: number | null;
  /** JSON of step timings, e.g. `{"render_ms": 45}`. Populated from the
   *  layout's `after()` block. */
  server_timing?: string | null;
  /** `hit` | `miss` | `none`. Always `none` for dynamic routes today;
   *  reserved so a future Cache-Control / ISR experiment can drive it. */
  cache_status?: string | null;
  /** Wall-clock ms from the proxy-injected start marker to layout's
   *  `after()` callback firing — approximates Server Component render time. */
  render_ms?: number | null;
};

export function addRouteLog(log: Omit<RouteLog, "id">): void {
  const db = openRouteLogWrite();
  if (!db) return;
  try {
    db.prepare(
      "INSERT INTO route_logs (started_at, route, duration_ms, status, details, response_bytes, server_timing, cache_status, render_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      log.started_at,
      log.route,
      log.duration_ms,
      log.status,
      log.details ?? null,
      log.response_bytes ?? null,
      log.server_timing ?? null,
      log.cache_status ?? null,
      log.render_ms ?? null,
    );
  } finally {
    db.close();
  }
}

export function getRouteLogs(limit = 200): RouteLog[] {
  return (
    safeQuery((db) => {
      if (!hasTable(db, "route_logs")) return [] as RouteLog[];
      const detailsSelect = hasColumn(db, "route_logs", "details")
        ? "details"
        : "NULL AS details";
      const responseBytesSelect = hasColumn(db, "route_logs", "response_bytes")
        ? "response_bytes"
        : "NULL AS response_bytes";
      const serverTimingSelect = hasColumn(db, "route_logs", "server_timing")
        ? "server_timing"
        : "NULL AS server_timing";
      const cacheStatusSelect = hasColumn(db, "route_logs", "cache_status")
        ? "cache_status"
        : "NULL AS cache_status";
      const renderMsSelect = hasColumn(db, "route_logs", "render_ms")
        ? "render_ms"
        : "NULL AS render_ms";
      return db
        .prepare(
          `SELECT id, started_at, route, duration_ms, status, ${detailsSelect}, ${responseBytesSelect}, ${serverTimingSelect}, ${cacheStatusSelect}, ${renderMsSelect} FROM route_logs ORDER BY started_at DESC, id DESC LIMIT ?`
        )
        .all(limit) as RouteLog[];
    }) ?? []
  );
}
