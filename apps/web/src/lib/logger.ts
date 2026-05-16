import "server-only";
import pino, { type Logger } from "pino";
import { insertServerLog } from "./db/server-logs";

// Issue #388 — structured backend logger. Two write surfaces:
//   1. pino → stdout (journald in prod, pino-pretty in dev)
//   2. warn+ → server_logs table (powers the unified /logs timeline)
//
// Usage:
//   const log = forModule("coach");
//   log.error({ user_id, trace_id, tool: "query_recovery" }, "tool call failed");
//
// The fields object is the first argument (pino convention); the message
// string is second. Warn+ events are also persisted to server_logs with the
// fields serialized into the details JSON column.

const isProd = process.env.NODE_ENV === "production";

const root: Logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),
  transport: isProd
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname",
        },
      },
});

type LogFields = {
  user_id?: number | null;
  trace_id?: string | null;
  [key: string]: unknown;
};

function safeStringify(value: unknown): string {
  // Guard against circular refs + JSON.stringify throw paths so a log call
  // never crashes the request. Falls back to a stub describing the failure.
  try {
    const seen = new WeakSet();
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === "object" && val !== null) {
        if (seen.has(val as object)) return "[Circular]";
        seen.add(val as object);
      }
      return val;
    });
  } catch (err) {
    return JSON.stringify({
      details_serialize_failed: err instanceof Error ? err.message : String(err),
    });
  }
}

function persistWarnOrAbove(
  level: "warn" | "error" | "fatal",
  module: string,
  message: string,
  fields: LogFields,
): void {
  try {
    const { user_id = null, trace_id = null, ...rest } = fields;
    insertServerLog({
      level,
      module,
      message,
      details: Object.keys(rest).length ? safeStringify(rest) : null,
      user_id: user_id ?? null,
      trace_id: trace_id ?? null,
    });
  } catch {
    // Never throw from the logger.
  }
}

export type ModuleLogger = {
  debug: (fields: LogFields, message: string) => void;
  info: (fields: LogFields, message: string) => void;
  warn: (fields: LogFields, message: string) => void;
  error: (fields: LogFields, message: string) => void;
  fatal: (fields: LogFields, message: string) => void;
};

export function forModule(module: string): ModuleLogger {
  const child = root.child({ module });
  return {
    debug(fields, message) {
      child.debug(fields, message);
    },
    info(fields, message) {
      child.info(fields, message);
    },
    warn(fields, message) {
      child.warn(fields, message);
      persistWarnOrAbove("warn", module, message, fields);
    },
    error(fields, message) {
      child.error(fields, message);
      persistWarnOrAbove("error", module, message, fields);
    },
    fatal(fields, message) {
      child.fatal(fields, message);
      persistWarnOrAbove("fatal", module, message, fields);
    },
  };
}

export const logger = root;
