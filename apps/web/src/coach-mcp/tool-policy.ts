// Every Cursor-backed Coach model runs through the same allowlisted MCP
// server. Keep this list provider-agnostic so switching models never silently
// removes a Coach capability. The underlying executeTool path still enforces
// tenant scoping, per-turn write deduplication, and sync cooldowns.
export const COACH_MCP_TOOL_NAMES = new Set([
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

export function isCoachMcpToolName(name: unknown): name is string {
  return typeof name === "string" && COACH_MCP_TOOL_NAMES.has(name);
}
