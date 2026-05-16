import "server-only";
import { hasTable, safeQuery } from "./connection";

// Issue #391 — unified event timeline. UNION ALLs the 6 event tables into
// one shape so /logs can render them in a single feed.

export type EventSource =
  | "server"
  | "web"
  | "ios"
  | "sync"
  | "coach"
  | "webhook"
  | "route";
export type EventLevel = "info" | "warn" | "error" | "fatal";

export type EventRow = {
  ts: string;
  source: EventSource;
  level: EventLevel;
  summary: string;
  payload: Record<string, unknown>;
  ref_id: string | null;
};

export type GetUnifiedEventsOpts = {
  sources?: EventSource[];
  levels?: EventLevel[];
  q?: string;
  since?: Date;
  limit?: number;
};

const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 1000;

function clampLimit(n: number | undefined): number {
  if (n == null || !Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(n), 1), MAX_LIMIT);
}

function safeParseJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw };
  }
}

function matchQ(row: EventRow, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (row.summary.toLowerCase().includes(needle)) return true;
  try {
    if (JSON.stringify(row.payload).toLowerCase().includes(needle)) return true;
  } catch {
    // ignore
  }
  return false;
}

type ServerLogRow = {
  id: number;
  created_at: string;
  level: EventLevel;
  module: string;
  message: string;
  details: string | null;
  user_id: number | null;
  trace_id: string | null;
};
type ClientLogRow = {
  id: number;
  created_at: string;
  source: "web" | "ios";
  level: "info" | "warn" | "error";
  kind: string;
  message: string;
  details: string | null;
  user_id: number;
  user_agent: string | null;
  app_version: string | null;
};
type SyncLogRow = {
  id: number;
  started_at: string;
  duration_ms: number;
  status: "ok" | "error";
  recovery_count: number | null;
  sleep_count: number | null;
  workouts_count: number | null;
  error_message: string | null;
  source: string | null;
  details: string | null;
  partial: number;
};
type ChatLogRow = {
  id: number;
  started_at: string;
  prompt_preview: string;
  duration_ms: number;
  status: "ok" | "error" | "aborted";
  response_length: number;
  error_message: string | null;
  thread_id: number | null;
  source: string | null;
  details: string | null;
};
type RouteLogRow = {
  id: number;
  started_at: string;
  route: string;
  duration_ms: number;
  status: number;
  details: string | null;
  render_ms: number | null;
};
type WebhookRow = {
  id: number;
  received_at: string;
  event_type: string;
  resource_id: string;
  trace_id: string | null;
  payload: string;
  attempts: number;
  last_error: string | null;
  status: string;
};

export function getUnifiedEvents(opts: GetUnifiedEventsOpts = {}): EventRow[] {
  const sources = opts.sources && opts.sources.length ? new Set(opts.sources) : null;
  const levels = opts.levels && opts.levels.length ? new Set(opts.levels) : null;
  const sinceIso = opts.since ? opts.since.toISOString() : null;
  const limit = clampLimit(opts.limit);

  return (
    safeQuery((db) => {
      const events: EventRow[] = [];

      const sinceClause = sinceIso ? `WHERE created_at >= '${sinceIso.replace(/'/g, "")}'` : "";
      const sinceClauseStarted = sinceIso
        ? `WHERE started_at >= '${sinceIso.replace(/'/g, "")}'`
        : "";
      const sinceClauseReceived = sinceIso
        ? `WHERE received_at >= '${sinceIso.replace(/'/g, "")}'`
        : "";

      if ((!sources || sources.has("server")) && hasTable(db, "server_logs")) {
        const rows = db
          .prepare(
            `SELECT id, created_at, level, module, message, details, user_id, trace_id
             FROM server_logs ${sinceClause} ORDER BY id DESC LIMIT ${limit}`,
          )
          .all() as ServerLogRow[];
        for (const r of rows) {
          events.push({
            ts: r.created_at,
            source: "server",
            level: r.level,
            summary: `[${r.module}] ${r.message}`,
            payload: {
              module: r.module,
              user_id: r.user_id,
              trace_id: r.trace_id,
              ...safeParseJson(r.details),
            },
            ref_id: null,
          });
        }
      }

      if ((!sources || sources.has("web") || sources.has("ios")) && hasTable(db, "client_logs")) {
        const rows = db
          .prepare(
            `SELECT id, created_at, source, level, kind, message, details, user_id, user_agent, app_version
             FROM client_logs ${sinceClause} ORDER BY id DESC LIMIT ${limit}`,
          )
          .all() as ClientLogRow[];
        for (const r of rows) {
          const src = r.source === "ios" ? "ios" : "web";
          if (sources && !sources.has(src)) continue;
          events.push({
            ts: r.created_at,
            source: src,
            level: r.level,
            summary: `[${r.kind}] ${r.message}`,
            payload: {
              kind: r.kind,
              user_id: r.user_id,
              user_agent: r.user_agent,
              app_version: r.app_version,
              ...safeParseJson(r.details),
            },
            ref_id: null,
          });
        }
      }

      if ((!sources || sources.has("sync")) && hasTable(db, "sync_logs")) {
        const rows = db
          .prepare(
            `SELECT id, started_at, duration_ms, status, recovery_count, sleep_count, workouts_count, error_message, source, details, partial
             FROM sync_logs ${sinceClauseStarted} ORDER BY id DESC LIMIT ${limit}`,
          )
          .all() as SyncLogRow[];
        for (const r of rows) {
          const level: EventLevel =
            r.status === "error" ? "error" : r.partial ? "warn" : "info";
          events.push({
            ts: r.started_at,
            source: "sync",
            level,
            summary:
              r.status === "ok"
                ? `sync ok · ${r.recovery_count ?? 0}r ${r.sleep_count ?? 0}s ${r.workouts_count ?? 0}w · ${(r.duration_ms / 1000).toFixed(1)}s`
                : `sync ${r.status}${r.partial ? " (partial)" : ""} · ${r.error_message ?? "unknown error"}`,
            payload: {
              duration_ms: r.duration_ms,
              recovery_count: r.recovery_count,
              sleep_count: r.sleep_count,
              workouts_count: r.workouts_count,
              error_message: r.error_message,
              source: r.source,
              partial: !!r.partial,
              ...safeParseJson(r.details),
            },
            ref_id: String(r.id),
          });
        }
      }

      if ((!sources || sources.has("coach")) && hasTable(db, "chat_logs")) {
        const rows = db
          .prepare(
            `SELECT id, started_at, prompt_preview, duration_ms, status, response_length, error_message, thread_id, source, details
             FROM chat_logs ${sinceClauseStarted} ORDER BY id DESC LIMIT ${limit}`,
          )
          .all() as ChatLogRow[];
        for (const r of rows) {
          const level: EventLevel = r.status === "ok" ? "info" : "error";
          events.push({
            ts: r.started_at,
            source: "coach",
            level,
            summary:
              r.status === "ok"
                ? `coach · ${(r.duration_ms / 1000).toFixed(1)}s · ${r.prompt_preview.slice(0, 80)}`
                : `coach ${r.status} · ${r.error_message ?? "no detail"}`,
            payload: {
              prompt_preview: r.prompt_preview,
              duration_ms: r.duration_ms,
              status: r.status,
              response_length: r.response_length,
              error_message: r.error_message,
              thread_id: r.thread_id,
              source: r.source,
              ...safeParseJson(r.details),
            },
            ref_id: r.thread_id != null ? String(r.thread_id) : null,
          });
        }
      }

      if ((!sources || sources.has("route")) && hasTable(db, "route_logs")) {
        const rows = db
          .prepare(
            `SELECT id, started_at, route, duration_ms, status, details, render_ms
             FROM route_logs ${sinceClauseStarted} ORDER BY id DESC LIMIT ${limit}`,
          )
          .all() as RouteLogRow[];
        for (const r of rows) {
          const level: EventLevel =
            r.status >= 500 ? "error" : r.status >= 400 ? "warn" : "info";
          events.push({
            ts: r.started_at,
            source: "route",
            level,
            summary: `${r.status} ${r.route} · ${r.duration_ms}ms`,
            payload: {
              route: r.route,
              status: r.status,
              duration_ms: r.duration_ms,
              render_ms: r.render_ms,
              ...safeParseJson(r.details),
            },
            ref_id: null,
          });
        }
      }

      if ((!sources || sources.has("webhook")) && hasTable(db, "webhook_events")) {
        const rows = db
          .prepare(
            `SELECT id, received_at, event_type, resource_id, trace_id, payload, attempts, last_error, status
             FROM webhook_events ${sinceClauseReceived} ORDER BY id DESC LIMIT ${limit}`,
          )
          .all() as WebhookRow[];
        for (const r of rows) {
          const level: EventLevel =
            r.status === "failed" || r.status === "discarded"
              ? "error"
              : r.status === "pending" && r.attempts > 0
                ? "warn"
                : "info";
          events.push({
            ts: r.received_at,
            source: "webhook",
            level,
            summary: `webhook · ${r.event_type} · ${r.status}${r.attempts > 1 ? ` (try ${r.attempts})` : ""}`,
            payload: {
              event_type: r.event_type,
              resource_id: r.resource_id,
              trace_id: r.trace_id,
              attempts: r.attempts,
              last_error: r.last_error,
              status: r.status,
              ...safeParseJson(r.payload),
            },
            ref_id: r.resource_id,
          });
        }
      }

      events.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

      let out = events;
      if (levels) {
        out = out.filter((e) => levels.has(e.level));
      }
      if (opts.q) {
        const q = opts.q;
        out = out.filter((e) => matchQ(e, q));
      }
      return out.slice(0, limit);
    }) ?? []
  );
}
