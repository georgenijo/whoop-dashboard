import "server-only";
import { openWrite, safeQuery, type DB } from "./connection";

// Issue #388 — server_logs storage helpers. The logger module
// (apps/web/src/lib/logger.ts) writes via insertServerLog on warn+.
// The /logs page reads via recentServerLogs.

export type ServerLogLevel = "info" | "warn" | "error" | "fatal";

export type ServerLogInsert = {
  level: ServerLogLevel;
  module: string;
  message: string;
  details?: string | null;
  user_id?: number | null;
  trace_id?: string | null;
};

export type ServerLogRow = {
  id: number;
  created_at: string;
  level: ServerLogLevel;
  module: string;
  message: string;
  details: string | null;
  user_id: number | null;
  trace_id: string | null;
};

const MESSAGE_TRUNCATE = 1024;
const DETAILS_TRUNCATE = 8192;

function truncate(s: string | null | undefined, n: number): string | null {
  if (s == null) return null;
  return s.length > n ? s.slice(0, n) : s;
}

export function insertServerLog(row: ServerLogInsert): void {
  const db: DB | null = openWrite();
  if (!db) return;
  try {
    db.prepare(
      `INSERT INTO server_logs (created_at, level, module, message, details, user_id, trace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      new Date().toISOString(),
      row.level,
      row.module.slice(0, 64),
      truncate(row.message, MESSAGE_TRUNCATE) ?? "",
      truncate(row.details ?? null, DETAILS_TRUNCATE),
      row.user_id ?? null,
      row.trace_id ?? null,
    );
  } finally {
    db.close();
  }
}

export type RecentServerLogsOpts = {
  since?: Date;
  level?: ServerLogLevel[];
  module?: string;
  limit?: number;
};

export function recentServerLogs(opts: RecentServerLogsOpts = {}): ServerLogRow[] {
  return (
    safeQuery((db) => {
      const wheres: string[] = [];
      const params: (string | number)[] = [];
      if (opts.since) {
        wheres.push("created_at >= ?");
        params.push(opts.since.toISOString());
      }
      if (opts.level && opts.level.length) {
        wheres.push(`level IN (${opts.level.map(() => "?").join(",")})`);
        params.push(...opts.level);
      }
      if (opts.module) {
        wheres.push("module = ?");
        params.push(opts.module);
      }
      const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
      const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
      return db
        .prepare(
          `SELECT id, created_at, level, module, message, details, user_id, trace_id
           FROM server_logs ${where}
           ORDER BY id DESC LIMIT ${limit}`,
        )
        .all(...params) as ServerLogRow[];
    }) ?? []
  );
}
