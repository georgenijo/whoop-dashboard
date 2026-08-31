"use client";

import type {
  CoachToolActivity,
  CoachWorkLog,
} from "@/lib/coach/work-log-types";
import { useEffect, useRef, useState } from "react";
import {
  AgentActivityLine,
  type AgentActivityState,
} from "@/components/brainless/agent-activity-line";
import CoachToolCall, { formatWorkDuration } from "./CoachToolCall";
import { workPhaseLabel } from "./useChatSend";

function activityState(status: CoachWorkLog["status"]): AgentActivityState {
  switch (status) {
    case "running":
      return "active";
    case "complete":
      return "complete";
    case "error":
      return "failed";
    case "aborted":
      return "stopped";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function activityLabel(status: CoachWorkLog["status"]): string {
  if (status === "running") return "Working";
  if (status === "complete") return "Worked";
  return "Stopped";
}

function partitionTools(tools: CoachToolActivity[]) {
  const completedIndexes = tools
    .map((tool, index) => ({ tool, index }))
    .filter(({ tool }) => tool.state === "complete")
    .map(({ index }) => index);
  const visibleCompleted = new Set(completedIndexes.slice(-3));
  return {
    previous: tools.filter(
      (tool, index) => tool.state === "complete" && !visibleCompleted.has(index),
    ),
    visible: tools.filter(
      (tool, index) => tool.state === "running" || visibleCompleted.has(index),
    ),
  };
}

export default function CoachWorkDisclosure({
  workLog,
  startedAt,
  hasVisibleText = false,
}: {
  workLog: CoachWorkLog;
  startedAt?: number;
  hasVisibleText?: boolean;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const previousStatus = useRef(workLog.status);
  const [elapsedMs, setElapsedMs] = useState(() =>
    startedAt == null ? 0 : Date.now() - startedAt,
  );

  useEffect(() => {
    if (detailsRef.current) {
      detailsRef.current.open = workLog.status === "running";
    }
    // The initial state is applied once. Subsequent live re-renders must not
    // override a user's manual collapse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (workLog.status !== "running" || startedAt == null) return;
    const tick = () => setElapsedMs(Date.now() - startedAt);
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [startedAt, workLog.status]);

  useEffect(() => {
    const prior = previousStatus.current;
    if (prior === "running" && workLog.status === "complete" && detailsRef.current) {
      detailsRef.current.open = false;
    } else if (
      prior === "running" &&
      (workLog.status === "error" || workLog.status === "aborted") &&
      detailsRef.current
    ) {
      detailsRef.current.open = true;
    }
    previousStatus.current = workLog.status;
  }, [workLog.status]);

  const { previous, visible } = partitionTools(workLog.tools);
  const phase = workPhaseLabel(workLog, hasVisibleText);
  const duration = formatWorkDuration(workLog.duration_ms ?? elapsedMs) || "0s";
  const detail =
    workLog.status === "running"
      ? phase
      : workLog.status === "error"
        ? "Turn failed"
        : workLog.status === "aborted"
          ? "Turn stopped"
          : null;

  return (
    <details
      ref={detailsRef}
      className={`coach-work-disclosure ${workLog.status}`}
    >
      <summary>
        <AgentActivityLine
          state={activityState(workLog.status)}
          label={activityLabel(workLog.status)}
          detail={detail}
          meta={duration}
        />
        <span className="coach-work-caret" aria-hidden="true" />
      </summary>
      <div className="coach-work-body">
        {workLog.notes.map((note, index) => (
          <div className="coach-work-trace-row" key={`${index}:${note}`}>
            <span className="coach-work-step complete" aria-hidden="true">
              <svg viewBox="0 0 16 16">
                <path d="m4 8 2.5 2.5L12 5" />
              </svg>
            </span>
            <p className="coach-work-note">{note}</p>
          </div>
        ))}
        {workLog.tools.length === 0 ? (
          workLog.status === "running" ? null : (
            <div className="coach-work-empty">No tool calls</div>
          )
        ) : (
          <div className="coach-tool-list">
            {previous.length > 0 ? (
              <details className="coach-previous-tools">
                <summary>+{previous.length} previous tool calls</summary>
                <div className="coach-tool-list">
                  {previous.map((tool) => (
                    <CoachToolCall key={tool.id} tool={tool} />
                  ))}
                </div>
              </details>
            ) : null}
            {visible.map((tool) => (
              <CoachToolCall key={tool.id} tool={tool} />
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
