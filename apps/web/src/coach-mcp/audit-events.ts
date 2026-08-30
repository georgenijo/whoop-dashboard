import { isCoachMcpToolName } from "./tool-policy";

export const COACH_MCP_AUDIT_VERSION = 1 as const;
export const COACH_MCP_AUDIT_MAX_LINE_CHARS = 20_000;

type AuditEventBase = {
  version: typeof COACH_MCP_AUDIT_VERSION;
  runtime_id: string;
  turn_epoch: string;
  call_id: string;
  tool_name: string;
  at_ms: number;
};

export type CoachMcpAuditStartEvent = AuditEventBase & {
  phase: "start";
  input: unknown;
};

export type CoachMcpAuditEndEvent = AuditEventBase & {
  phase: "end";
  duration_ms: number;
  rows: number | null;
  status: "ok" | "error";
  error?: string;
  response?: unknown;
};

export type CoachMcpAuditEvent =
  | CoachMcpAuditStartEvent
  | CoachMcpAuditEndEvent;

function boundedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

export function parseCoachMcpAuditEvent(
  line: string,
): CoachMcpAuditEvent | null {
  if (!line || line.length > COACH_MCP_AUDIT_MAX_LINE_CHARS) return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (
    event.version !== COACH_MCP_AUDIT_VERSION ||
    !boundedString(event.runtime_id) ||
    !boundedString(event.turn_epoch) ||
    !boundedString(event.call_id) ||
    !isCoachMcpToolName(event.tool_name) ||
    typeof event.at_ms !== "number" ||
    !Number.isFinite(event.at_ms) ||
    event.at_ms < 0
  ) {
    return null;
  }
  if (event.phase === "start") {
    return value as CoachMcpAuditStartEvent;
  }
  if (
    event.phase !== "end" ||
    typeof event.duration_ms !== "number" ||
    !Number.isFinite(event.duration_ms) ||
    event.duration_ms < 0 ||
    (event.rows !== null &&
      (!Number.isInteger(event.rows) || (event.rows as number) < 0)) ||
    (event.status !== "ok" && event.status !== "error") ||
    (event.error !== undefined && typeof event.error !== "string")
  ) {
    return null;
  }
  return value as CoachMcpAuditEndEvent;
}
