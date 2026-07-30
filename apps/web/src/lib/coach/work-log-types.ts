export type CoachWorkLogStatus = "running" | "complete" | "error" | "aborted";

export type CoachToolActivity = {
  id: string;
  name: string;
  input: unknown;
  state: "running" | "complete";
  status: "ok" | "error" | null;
  duration_ms: number | null;
  rows: number | null;
  stage?: string;
  stage_message?: string;
  error?: string;
  response?: unknown;
};

export type CoachWorkLog = {
  version: 1;
  status: CoachWorkLogStatus;
  duration_ms: number | null;
  notes: string[];
  tools: CoachToolActivity[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolActivity(value: unknown): value is CoachToolActivity {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    Object.hasOwn(value, "input") &&
    (value.state === "running" || value.state === "complete") &&
    (value.status === null || value.status === "ok" || value.status === "error") &&
    (value.duration_ms === null || typeof value.duration_ms === "number") &&
    (value.rows === null || typeof value.rows === "number") &&
    (value.stage === undefined || typeof value.stage === "string") &&
    (value.stage_message === undefined ||
      typeof value.stage_message === "string") &&
    (value.error === undefined || typeof value.error === "string")
  );
}

export function isCoachWorkLog(value: unknown): value is CoachWorkLog {
  if (!isRecord(value) || value.version !== 1) return false;
  if (
    value.status !== "running" &&
    value.status !== "complete" &&
    value.status !== "error" &&
    value.status !== "aborted"
  ) {
    return false;
  }
  return (
    (value.duration_ms === null || typeof value.duration_ms === "number") &&
    Array.isArray(value.notes) &&
    value.notes.every((note) => typeof note === "string") &&
    Array.isArray(value.tools) &&
    value.tools.every(isToolActivity)
  );
}

export function parseCoachWorkLog(value: unknown): CoachWorkLog | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isCoachWorkLog(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isCoachWorkLog(value) ? value : null;
}

export function newRunningWorkLog(): CoachWorkLog {
  return {
    version: 1,
    status: "running",
    duration_ms: null,
    notes: [],
    tools: [],
  };
}
