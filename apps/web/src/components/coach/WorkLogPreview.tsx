"use client";

import type {
  CoachToolActivity,
  CoachWorkLog,
} from "@/lib/coach/work-log-types";
import { useEffect, useRef, useState } from "react";
import MessageBubble from "./MessageBubble";

type Scenario = "direct" | "tools" | "failure";

const recoveryResponse = [
  { date: "2026-07-30", recovery_score: 86, hrv: 46.1, rhr: 61 },
  { date: "2026-07-29", recovery_score: 78, hrv: 44.7, rhr: 62 },
];

function completedTool(
  id: string,
  name: string,
  durationMs: number,
  rows: number,
  input: unknown,
  response: unknown,
): CoachToolActivity {
  return {
    id,
    name,
    input,
    state: "complete",
    status: "ok",
    duration_ms: durationMs,
    rows,
    response,
  };
}

const initialLog: CoachWorkLog = {
  version: 1,
  status: "complete",
  duration_ms: 546_000,
  notes: ["I’ll compare your current month with the previous month."],
  tools: [
    completedTool(
      "older-recovery",
      "query_recovery",
      81,
      30,
      { start_date: "2026-05-01", end_date: "2026-05-31" },
      recoveryResponse,
    ),
    completedTool(
      "older-sleep",
      "query_sleep",
      94,
      30,
      { start_date: "2026-05-01", end_date: "2026-05-31" },
      [{ date: "2026-05-31", performance: 79 }],
    ),
    completedTool(
      "current-recovery",
      "query_recovery",
      97,
      30,
      { start_date: "2026-07-01", end_date: "2026-07-30" },
      recoveryResponse,
    ),
    completedTool(
      "previous-recovery",
      "query_recovery",
      112,
      30,
      { start_date: "2026-06-01", end_date: "2026-06-30" },
      recoveryResponse,
    ),
    completedTool(
      "current-sleep",
      "query_sleep",
      104,
      30,
      { start_date: "2026-07-01", end_date: "2026-07-30" },
      [{ date: "2026-07-30", performance: 80, efficiency: 95 }],
    ),
  ],
};

const finalAnswer =
  "Your recovery is trending up: the current-month average is **74%**, compared with **69%** last month. Sleep efficiency is steady, while total sleep time is still the clearest opportunity.";

export default function WorkLogPreview() {
  const [content, setContent] = useState(finalAnswer);
  const [workLog, setWorkLog] = useState<CoachWorkLog>(initialLog);
  const [startedAt, setStartedAt] = useState<number | undefined>();
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  };

  useEffect(() => clearTimers, []);

  const later = (delay: number, action: () => void) => {
    timers.current.push(window.setTimeout(action, delay));
  };

  const run = (scenario: Scenario) => {
    clearTimers();
    const start = Date.now();
    setStartedAt(start);
    setContent("");
    setWorkLog({
      version: 1,
      status: "running",
      duration_ms: null,
      notes: [],
      tools: [],
    });

    if (scenario === "direct") {
      later(900, () => setContent("You’re in good shape this morning."));
      later(2200, () => {
        setContent(
          "You’re in good shape this morning. Recovery is green at **86%**.",
        );
        setWorkLog({
          version: 1,
          status: "complete",
          duration_ms: 2200,
          notes: [],
          tools: [],
        });
      });
      return;
    }

    const current: CoachToolActivity = {
      id: "live-current",
      name: "query_recovery",
      input: { start_date: "2026-07-01", end_date: "2026-07-30" },
      state: "running",
      status: null,
      duration_ms: null,
      rows: null,
    };
    later(650, () => {
      setWorkLog((log) => ({
        ...log,
        notes: ["I’ll compare your current month with the previous month."],
        tools: [current],
      }));
    });

    if (scenario === "failure") {
      later(1700, () => {
        setContent("**Error:** The recovery query stopped before finishing.");
        setWorkLog({
          version: 1,
          status: "error",
          duration_ms: 1700,
          notes: ["I’ll pull your recent recovery data."],
          tools: [
            {
              ...current,
              state: "complete",
              status: "error",
              duration_ms: 1018,
              error: "Database unavailable",
              response: { error: "Database unavailable" },
            },
          ],
        });
      });
      return;
    }

    later(1400, () => {
      setWorkLog((log) => ({
        ...log,
        tools: [
          completedTool(
            "live-current",
            "query_recovery",
            97,
            30,
            current.input,
            recoveryResponse,
          ),
          {
            id: "live-previous",
            name: "query_recovery",
            input: { start_date: "2026-06-01", end_date: "2026-06-30" },
            state: "running",
            status: null,
            duration_ms: null,
            rows: null,
          },
          {
            id: "live-sleep",
            name: "query_sleep",
            input: { start_date: "2026-07-01", end_date: "2026-07-30" },
            state: "running",
            status: null,
            duration_ms: null,
            rows: null,
            stage: "reading_sleep",
            stage_message: "Reading sleep rows",
          },
        ],
      }));
    });
    later(2450, () => {
      setWorkLog((log) => ({
        ...log,
        tools: [
          log.tools[0],
          completedTool(
            "live-previous",
            "query_recovery",
            112,
            30,
            { start_date: "2026-06-01", end_date: "2026-06-30" },
            recoveryResponse,
          ),
          completedTool(
            "live-sleep",
            "query_sleep",
            104,
            30,
            { start_date: "2026-07-01", end_date: "2026-07-30" },
            [{ date: "2026-07-30", performance: 80, efficiency: 95 }],
          ),
        ],
      }));
    });
    later(3000, () => setContent(finalAnswer));
    later(3800, () => {
      setWorkLog((log) => ({
        ...log,
        status: "complete",
        duration_ms: 3800,
      }));
    });
  };

  return (
    <div className="coach-page">
      <div className="coach-topbar" style={{ position: "relative" }}>
        <div className="coach-title-block">
          <div className="coach-kicker">Feature preview · PR #455</div>
          <h1>Expandable Coach Work Log</h1>
          <div className="coach-subtitle">
            Dev-only scripted data. Expand the work row, prior-call group, and
            individual tools.
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <button className="btn primary" onClick={() => run("tools")}>
          Run multi-tool turn
        </button>
        <button className="btn secondary" onClick={() => run("direct")}>
          Run direct reply
        </button>
        <button className="btn secondary" onClick={() => run("failure")}>
          Run failure
        </button>
        <button
          className="btn secondary"
          onClick={() => {
            clearTimers();
            setStartedAt(undefined);
            setContent(finalAnswer);
            setWorkLog(initialLog);
          }}
        >
          Reset completed example
        </button>
      </div>
      <div className="coach-chat" style={{ minHeight: 620 }}>
        <div className="coach-messages">
          <MessageBubble
            msg={{
              role: "user",
              content: "How am I doing compared with last month?",
            }}
          />
          <MessageBubble
            msg={{
              role: "assistant",
              content,
              streaming: workLog.status === "running",
              workLog,
              workStartedAt: startedAt,
            }}
          />
        </div>
      </div>
    </div>
  );
}
