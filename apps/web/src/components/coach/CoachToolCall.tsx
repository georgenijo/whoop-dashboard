"use client";

import ToolResponseBlock from "@/components/logs/ToolResponseBlock";
import type { CoachToolActivity } from "@/lib/coach/work-log-types";

const TOOL_LABELS: Record<string, { active: string; complete: string }> = {
  query_recovery: { active: "Querying recovery", complete: "Queried recovery" },
  query_sleep: { active: "Querying sleep", complete: "Queried sleep" },
  query_strain: { active: "Querying strain", complete: "Queried strain" },
  query_workouts: { active: "Querying workouts", complete: "Queried workouts" },
  query_naps: { active: "Querying naps", complete: "Queried naps" },
  query_journal: { active: "Querying journal", complete: "Queried journal" },
  query_daily_snapshot: {
    active: "Querying daily snapshot",
    complete: "Queried daily snapshot",
  },
  query_workout_plans: {
    active: "Querying workout plans",
    complete: "Queried workout plans",
  },
  save_workout_plan: {
    active: "Saving workout plan",
    complete: "Saved workout plan",
  },
  trigger_whoop_sync: { active: "Syncing Whoop", complete: "Synced Whoop" },
};

export function coachToolLabel(name: string, running = false): string {
  const known = TOOL_LABELS[name];
  if (known) return running ? known.active : known.complete;
  return (
    name
      .replace(/^query_/, running ? "Querying " : "Queried ")
      .replaceAll("_", " ")
      .replace(/^\w/, (character) => character.toUpperCase())
  );
}

export function formatWorkDuration(durationMs: number | null): string {
  if (durationMs == null) return "";
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
  }
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[Unable to serialize input]";
  }
}

export default function CoachToolCall({ tool }: { tool: CoachToolActivity }) {
  const running = tool.state === "running";
  const failed = tool.status === "error";
  const duration = formatWorkDuration(tool.duration_ms);
  const rowCount =
    tool.rows == null ? "" : `${tool.rows} row${tool.rows === 1 ? "" : "s"}`;
  const stage = tool.stage_message ?? tool.stage?.replaceAll("_", " ");

  return (
    <details className={`coach-tool-call ${running ? "running" : failed ? "error" : "complete"}`}>
      <summary>
        <span className="coach-tool-state" aria-hidden="true">
          {!running ? (
            <svg viewBox="0 0 16 16">
              {failed ? (
                <path d="m5 5 6 6m0-6-6 6" />
              ) : (
                <path d="m4 8 2.5 2.5L12 5" />
              )}
            </svg>
          ) : null}
        </span>
        <span className="coach-tool-label">{coachToolLabel(tool.name, running)}</span>
        {rowCount || stage || duration ? (
          <span className="coach-tool-meta">
            {rowCount ? <span>{rowCount}</span> : null}
            {stage ? <span>{stage}</span> : null}
            {duration ? <span className="coach-tool-duration">{duration}</span> : null}
          </span>
        ) : null}
      </summary>
      <div className="coach-tool-detail">
        <div className="coach-work-field coach-work-field-compact">
          <span>Tool</span>
          <code>{tool.name}</code>
        </div>
        <div className="coach-work-field coach-work-field-compact">
          <span>Status</span>
          <code>{running ? "running" : tool.status ?? "complete"}</code>
        </div>
        <div className="coach-work-field coach-work-field-wide">
          <span>Input</span>
          <pre>{prettyJson(tool.input)}</pre>
        </div>
        {tool.error ? (
          <div className="coach-work-field coach-work-field-wide error">
            <span>Error</span>
            <pre>{tool.error}</pre>
          </div>
        ) : null}
        {!running ? (
          <div className="coach-work-field coach-work-field-wide">
            <span>Result</span>
            <div className="coach-tool-response">
              <ToolResponseBlock toolName={tool.name} response={tool.response} />
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}
