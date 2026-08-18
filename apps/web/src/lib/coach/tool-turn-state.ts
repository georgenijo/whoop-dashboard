/** State shared by every tool call within exactly one Coach turn. */
export type ToolTurnState = {
  syncAttempts: number;
  savedPlanHashes: Map<string, number>;
};

export function newToolTurnState(): ToolTurnState {
  return { syncAttempts: 0, savedPlanHashes: new Map() };
}
