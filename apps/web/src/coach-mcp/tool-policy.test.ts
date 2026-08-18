import { describe, expect, it } from "vitest";
import { COACH_MCP_TOOL_NAMES, isCoachMcpToolName } from "./tool-policy";

describe("Cursor Coach MCP tool policy", () => {
  it("gives every Cursor-backed model the complete Coach tool surface", () => {
    expect([...COACH_MCP_TOOL_NAMES]).toEqual([
      "query_recovery",
      "query_sleep",
      "query_strain",
      "query_workouts",
      "query_naps",
      "query_journal",
      "query_daily_snapshot",
      "query_workout_plans",
      "save_workout_plan",
      "trigger_whoop_sync",
      "view_chat_image",
    ]);
    for (const name of COACH_MCP_TOOL_NAMES) {
      expect(isCoachMcpToolName(name)).toBe(true);
    }
  });

  it("keeps unapproved built-in capabilities outside the Coach tool surface", () => {
    expect(isCoachMcpToolName("shell")).toBe(false);
    expect(isCoachMcpToolName("web_fetch")).toBe(false);
    expect(isCoachMcpToolName(undefined)).toBe(false);
  });
});
