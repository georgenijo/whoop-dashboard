"use client";

import type {
  CoachToolActivity,
  CoachWorkLog,
} from "@/lib/coach/work-log-types";
import { useEffect, useRef, useState } from "react";
import CoachActivityMark from "./CoachActivityMark";
import CoachToolCall, { formatWorkDuration } from "./CoachToolCall";
import { workPhaseLabel } from "./useChatSend";

function disclosureLabel(workLog: CoachWorkLog, elapsedMs: number): string {
  const duration = workLog.duration_ms ?? elapsedMs;
  const formatted = formatWorkDuration(duration) || "0s";
  if (workLog.status === "running") return `Working for ${formatted}`;
  if (workLog.status === "complete") return `Worked for ${formatted}`;
  return `Stopped after ${formatted}`;
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
  const hasActivity = workLog.notes.length > 0 || workLog.tools.length > 0;

  return (
    <details
      ref={detailsRef}
      className={`coach-work-disclosure ${workLog.status}`}
    >
      <summary>
        <CoachActivityMark active={workLog.status === "running"} />
        <span className="coach-work-summary-label">
          {disclosureLabel(workLog, elapsedMs)}
        </span>
        {phase && !hasActivity ? (
          <span className="coach-work-summary-phase">{phase}</span>
        ) : null}
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
        {phase && hasActivity ? (
          <div className="coach-work-phase">{phase}</div>
        ) : null}
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
