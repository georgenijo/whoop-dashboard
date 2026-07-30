"use client";

import ToolResponseBlock from "@/components/logs/ToolResponseBlock";
import type { CoachToolActivity } from "@/lib/coach/work-log-types";

const TOOL_LABELS: Record<string, string> = {
  query_recovery: "Queried recovery",
  query_sleep: "Queried sleep",
  query_strain: "Queried strain",
  query_workouts: "Queried workouts",
  query_naps: "Queried naps",
  query_journal: "Queried journal",
  query_daily_snapshot: "Queried daily snapshot",
  query_workout_plans: "Queried workout plans",
  save_workout_plan: "Saved workout plan",
  trigger_whoop_sync: "Synced Whoop",
};

export function coachToolLabel(name: string): string {
  return (
    TOOL_LABELS[name] ??
    name
      .replace(/^query_/, "Queried ")
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
  const metadata = [
    formatWorkDuration(tool.duration_ms),
    tool.rows == null ? "" : `${tool.rows} row${tool.rows === 1 ? "" : "s"}`,
    tool.stage_message ?? tool.stage?.replaceAll("_", " "),
  ].filter(Boolean);

  return (
    <details className={`coach-tool-call ${running ? "running" : failed ? "error" : "complete"}`}>
      <summary>
        <span className="coach-tool-state" aria-hidden="true" />
        <span className="coach-tool-label">{coachToolLabel(tool.name)}</span>
        {metadata.length > 0 ? (
          <span className="coach-tool-meta">{metadata.join(" · ")}</span>
        ) : null}
      </summary>
      <div className="coach-tool-detail">
        <div className="coach-work-field">
          <span>Tool</span>
          <code>{tool.name}</code>
        </div>
        <div className="coach-work-field">
          <span>Input</span>
          <pre>{prettyJson(tool.input)}</pre>
        </div>
        <div className="coach-work-field">
          <span>Status</span>
          <code>{running ? "running" : tool.status ?? "complete"}</code>
        </div>
        {tool.error ? (
          <div className="coach-work-field error">
            <span>Error</span>
            <pre>{tool.error}</pre>
          </div>
        ) : null}
        {!running ? (
          <div className="coach-work-field">
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
