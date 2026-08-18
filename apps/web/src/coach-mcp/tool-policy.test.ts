import { describe, expect, it } from "vitest";
import { COACH_MCP_TOOL_NAMES, isCoachMcpToolName } from "./tool-policy";

describe("Cursor Coach MCP tool policy", () => {
  it("gives every Cursor-backed model the guarded Whoop sync tool", () => {
    expect(COACH_MCP_TOOL_NAMES).toContain("trigger_whoop_sync");
    expect(isCoachMcpToolName("trigger_whoop_sync")).toBe(true);
  });

  it("keeps unapproved built-in capabilities outside the Coach tool surface", () => {
    expect(isCoachMcpToolName("shell")).toBe(false);
    expect(isCoachMcpToolName("web_fetch")).toBe(false);
    expect(isCoachMcpToolName(undefined)).toBe(false);
  });
});
