/** State shared by every tool call within exactly one Coach turn. */
export const MAX_COACH_MCP_TOOL_CALLS = 12;

export type ToolTurnState = {
  syncAttempts: number;
  savedPlanHashes: Map<string, number>;
  mcpToolCalls: number;
};

export function newToolTurnState(): ToolTurnState {
  return { syncAttempts: 0, savedPlanHashes: new Map(), mcpToolCalls: 0 };
}
