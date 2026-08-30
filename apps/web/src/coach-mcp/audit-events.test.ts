import { describe, expect, it } from "vitest";
import {
  COACH_MCP_AUDIT_MAX_LINE_CHARS,
  parseCoachMcpAuditEvent,
} from "./audit-events";

function startEvent(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    runtime_id: "runtime-1",
    turn_epoch: "turn-1",
    call_id: "call-1",
    tool_name: "query_recovery",
    phase: "start",
    at_ms: 10,
    input: { start_date: "2026-08-30" },
    ...overrides,
  });
}

describe("parseCoachMcpAuditEvent", () => {
  it("accepts a versioned allowlisted event", () => {
    expect(parseCoachMcpAuditEvent(startEvent())).toMatchObject({
      version: 1,
      tool_name: "query_recovery",
      phase: "start",
    });
  });

  it("rejects unknown tools, malformed completions, and oversized lines", () => {
    expect(
      parseCoachMcpAuditEvent(startEvent({ tool_name: "read_file" })),
    ).toBeNull();
    expect(
      parseCoachMcpAuditEvent(
        startEvent({ phase: "end", duration_ms: -1, status: "ok", rows: 1 }),
      ),
    ).toBeNull();
    expect(
      parseCoachMcpAuditEvent("x".repeat(COACH_MCP_AUDIT_MAX_LINE_CHARS + 1)),
    ).toBeNull();
  });
});
