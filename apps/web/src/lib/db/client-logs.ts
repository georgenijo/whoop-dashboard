import "server-only";
import { openWrite, safeQuery, type DB } from "./connection";

// Issue #388 — client_logs storage helpers. Written by the
// /api/log/client endpoint (web + iOS post here). Read by the /logs page.

export type ClientLogSource = "web" | "ios";
export type ClientLogLevel = "info" | "warn" | "error";
export type ClientLogKind = "error" | "pageview" | "click" | "lifecycle" | "event";

export type ClientLogInsert = {
  source: ClientLogSource;
  level: ClientLogLevel;
  kind: ClientLogKind;
  message: string;
  details?: string | null;
  user_id: number;
  user_agent?: string | null;
  app_version?: string | null;
};

export type ClientLogRow = {
  id: number;
  created_at: string;
  source: ClientLogSource;
  level: ClientLogLevel;
  kind: ClientLogKind;
  message: string;
  details: string | null;
  user_id: number;
  user_agent: string | null;
  app_version: string | null;
};

const MESSAGE_TRUNCATE = 1024;
const DETAILS_TRUNCATE = 4096;
const UA_TRUNCATE = 512;

function truncate(s: string | null | undefined, n: number): string | null {
  if (s == null) return null;
  return s.length > n ? s.slice(0, n) : s;
}

export function insertClientLog(row: ClientLogInsert): void {
  const db: DB | null = openWrite();
  if (!db) return;
  try {
    db.prepare(
      `INSERT INTO client_logs
         (created_at, source, level, kind, message, details, user_id, user_agent, app_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      new Date().toISOString(),
      row.source,
      row.level,
      row.kind,
      truncate(row.message, MESSAGE_TRUNCATE) ?? "",
      truncate(row.details ?? null, DETAILS_TRUNCATE),
      row.user_id,
      truncate(row.user_agent ?? null, UA_TRUNCATE),
      truncate(row.app_version ?? null, 64),
    );
  } finally {
    db.close();
  }
}

export type RecentClientLogsOpts = {
  since?: Date;
  source?: ClientLogSource;
  kind?: ClientLogKind[];
  level?: ClientLogLevel[];
  user_id?: number;
  limit?: number;
};

export function recentClientLogs(opts: RecentClientLogsOpts = {}): ClientLogRow[] {
  return (
    safeQuery((db) => {
      const wheres: string[] = [];
      const params: (string | number)[] = [];
      if (opts.since) {
        wheres.push("created_at >= ?");
        params.push(opts.since.toISOString());
      }
      if (opts.source) {
        wheres.push("source = ?");
        params.push(opts.source);
      }
      if (opts.kind && opts.kind.length) {
        wheres.push(`kind IN (${opts.kind.map(() => "?").join(",")})`);
        params.push(...opts.kind);
      }
      if (opts.level && opts.level.length) {
        wheres.push(`level IN (${opts.level.map(() => "?").join(",")})`);
        params.push(...opts.level);
      }
      if (opts.user_id != null) {
        wheres.push("user_id = ?");
        params.push(opts.user_id);
      }
      const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
      const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
      return db
        .prepare(
          `SELECT id, created_at, source, level, kind, message, details, user_id, user_agent, app_version
           FROM client_logs ${where}
           ORDER BY id DESC LIMIT ${limit}`,
        )
        .all(...params) as ClientLogRow[];
    }) ?? []
  );
}
