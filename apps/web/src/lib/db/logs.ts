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
            details TEXT
          );
          CREATE INDEX IF NOT EXISTS route_logs_started_at_idx ON route_logs(started_at DESC);
        `);
        const cols = db.prepare("PRAGMA table_info(route_logs)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "details")) {
          db.exec("ALTER TABLE route_logs ADD COLUMN details TEXT");
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
  source: "web" | "ios" | "dev" | null;
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
};

export function addSyncLog(log: Omit<SyncLog, "id">): void {
  const db = openWrite();
  if (!db) return;
  try {
    db.prepare(
      "INSERT INTO sync_logs (started_at, duration_ms, status, recovery_count, sleep_count, workouts_count, error_message, source, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      log.started_at,
      log.duration_ms,
      log.status,
      log.recovery_count,
      log.sleep_count,
      log.workouts_count,
      log.error_message,
      log.source,
      log.details ?? null
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
      return db
        .prepare(
          `SELECT id, started_at, duration_ms, status, recovery_count, sleep_count, workouts_count, error_message, source, ${detailsSelect} FROM sync_logs ORDER BY id DESC LIMIT ?`
        )
        .all(limit) as SyncLog[];
    }) ?? []
  );
}

export type RouteLog = {
  id: number;
  started_at: string;
  route: string;
  duration_ms: number;
  status: number;
  details?: string | null;
};

export function addRouteLog(log: Omit<RouteLog, "id">): void {
  const db = openRouteLogWrite();
  if (!db) return;
  try {
    db.prepare(
      "INSERT INTO route_logs (started_at, route, duration_ms, status, details) VALUES (?, ?, ?, ?, ?)"
    ).run(log.started_at, log.route, log.duration_ms, log.status, log.details ?? null);
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
      return db
        .prepare(
          `SELECT id, started_at, route, duration_ms, status, ${detailsSelect} FROM route_logs ORDER BY started_at DESC, id DESC LIMIT ?`
        )
        .all(limit) as RouteLog[];
    }) ?? []
  );
}
