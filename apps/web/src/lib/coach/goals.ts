// Canonical coach-goal IDs. Three callers reference this set: the welcome
// wizard (client chip list), the /api/me/coach-goals POST handler (input
// filter), and the server-side system-prompt builder (label lookup). Keep
// them in lock-step here so a future fifth goal lands in one place, not
// three. No `server-only` — the welcome wizard imports this from a "use
// client" file.

export const COACH_GOAL_IDS = [
  "sleep_better",
  "recover_faster",
  "train_smarter",
  "manage_stress",
] as const;

export type CoachGoalId = (typeof COACH_GOAL_IDS)[number];

export const COACH_GOAL_LABELS: Record<CoachGoalId, string> = {
  sleep_better: "Sleep better",
  recover_faster: "Recover faster",
  train_smarter: "Train smarter",
  manage_stress: "Manage stress",
};

export const COACH_GOAL_SET: ReadonlySet<string> = new Set(COACH_GOAL_IDS);
