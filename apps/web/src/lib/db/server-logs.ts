import "server-only";
import { openWrite, type DB } from "./connection";

// Issue #388 — server_logs storage helpers. The logger module
// (apps/web/src/lib/logger.ts) writes via insertServerLog on warn+.
// Nothing reads server_logs through the app yet: /logs shows sync, chat,
// route and client logs. Rows are inspected directly in SQLite.

export type ServerLogLevel = "info" | "warn" | "error" | "fatal";

export type ServerLogInsert = {
  level: ServerLogLevel;
  module: string;
  message: string;
  details?: string | null;
  user_id?: number | null;
  trace_id?: string | null;
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
