"use client";

import { useMemo, useState, useId } from "react";

type ChatLogRow = {
  id: number;
  started_at: string;
  prompt_preview: string;
  duration_ms: number;
  status: string;
  details?: string | null;
};

type ToolDetail = {
  name: string;
  input: unknown;
  duration_ms: number;
  rows: number | null;
  status: "ok" | "error";
  error?: string;
};

type LogDetails = {
  full_prompt?: string;
  iterations?: number;
  tools?: ToolDetail[];
  usage?: {
    input_tokens_total?: number;
    output_tokens_total?: number;
    cache_creation_input_tokens_total?: number;
    cache_read_input_tokens_total?: number;
    calls?: number;
  };
};

function parseDetails(details?: string | null): LogDetails | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as LogDetails;
  } catch {
    return null;
  }
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function fmtDuration(ms: number): string {
  const s = ms / 1000;
  return s < 1 ? `${ms}ms` : `${s.toFixed(1)}s`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  }) + " EST";
}

function ChatDetailPanel({ log, details }: { log: ChatLogRow; details: LogDetails }) {
  const usage = details.usage;
  return (
    <div className="atelier-section-detail">
      <div className="atelier-detail-group">
        <div className="atelier-detail-label">Full prompt</div>
        <div className="atelier-detail-text">{details.full_prompt || log.prompt_preview}</div>
      </div>

      <div className="atelier-detail-metrics">
        <div className="atelier-detail-metric">
          <div className="atelier-detail-metric-label">Iterations</div>
          <div className="atelier-detail-metric-value">{details.iterations ?? 0}</div>
        </div>
        <div className="atelier-detail-metric">
          <div className="atelier-detail-metric-label">Calls</div>
          <div className="atelier-detail-metric-value">{usage?.calls ?? 0}</div>
        </div>
        <div className="atelier-detail-metric">
          <div className="atelier-detail-metric-label">Input tkns</div>
          <div className="atelier-detail-metric-value">{usage?.input_tokens_total ?? 0}</div>
        </div>
        <div className="atelier-detail-metric">
          <div className="atelier-detail-metric-label">Output tkns</div>
          <div className="atelier-detail-metric-value">{usage?.output_tokens_total ?? 0}</div>
        </div>
        <div className="atelier-detail-metric">
          <div className="atelier-detail-metric-label">Cache write</div>
          <div className="atelier-detail-metric-value">{usage?.cache_creation_input_tokens_total ?? 0}</div>
        </div>
        <div className="atelier-detail-metric">
          <div className="atelier-detail-metric-label">Cache read</div>
          <div className="atelier-detail-metric-value">{usage?.cache_read_input_tokens_total ?? 0}</div>
        </div>
      </div>

      <div className="atelier-detail-group">
        <div className="atelier-detail-label">Tools</div>
        {(details.tools?.length ?? 0) === 0 ? (
          <div className="atelier-detail-muted">No tool calls</div>
        ) : (
          <div className="atelier-tool-list">
            {details.tools?.map((tool, idx) => (
              <div key={`${tool.name}-${idx}`} className="atelier-tool-item">
                <div className="atelier-tool-header">
                  <span className="atelier-tool-name">{tool.name}</span>
                  <span className="atelier-tool-dur">{fmtDuration(tool.duration_ms)}</span>
                  <span className="atelier-tool-rows">rows {tool.rows ?? "—"}</span>
                  <span className={`atelier-tool-badge atelier-tool-badge-${tool.status}`}>{tool.status}</span>
                </div>
                <pre className="atelier-tool-input">{stringify(tool.input)}</pre>
                {tool.error ? <div className="atelier-tool-error">{tool.error}</div> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChatRow({ log }: { log: ChatLogRow }) {
  const [open, setOpen] = useState(false);
  const details = useMemo(() => parseDetails(log.details), [log.details]);
  const hasDetails = details !== null;
  const detailsId = `atelier-chat-${log.id}`;

  return (
    <>
      <tr
        className={`atelier-section-row${hasDetails ? " clickable" : ""}${open ? " open" : ""}`}
        onClick={hasDetails ? () => setOpen((v) => !v) : undefined}
        aria-expanded={hasDetails ? open : undefined}
        aria-controls={hasDetails ? detailsId : undefined}
      >
        <td className="atelier-section-time">{fmtTime(log.started_at)}</td>
        <td className="atelier-section-primary">{log.prompt_preview}</td>
        <td className="atelier-section-dur">{fmtDuration(log.duration_ms)}</td>
        <td className="atelier-section-status">
          <span className={`atelier-section-badge atelier-section-badge-${log.status === "ok" ? "ok" : "error"}`}>
            {log.status}
          </span>
        </td>
        <td className="atelier-section-chevron-cell">
          {hasDetails && (
            <svg aria-hidden="true" viewBox="0 0 16 16" className={`atelier-section-chevron${open ? " open" : ""}`}>
              <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
            </svg>
          )}
        </td>
      </tr>
      {open && hasDetails && (
        <tr id={detailsId} className="atelier-section-detail-row">
          <td colSpan={5}>
            <ChatDetailPanel log={log} details={details} />
          </td>
        </tr>
      )}
    </>
  );
}

type Props = {
  logs: ChatLogRow[];
};

export default function AtelierChatSection({ logs }: Props) {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  return (
    <div className="atelier-collapsible-section">
      <button
        type="button"
        className="atelier-collapsible-header"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="atelier-collapsible-title-group">
          <span className="atelier-collapsible-index">I</span>
          <span className="atelier-collapsible-title">Chat request log</span>
          <span className="atelier-collapsible-sub">{logs.length} entries</span>
        </div>
        <svg aria-hidden="true" viewBox="0 0 16 16" className={`atelier-collapsible-chevron${open ? " open" : ""}`}>
          <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </svg>
      </button>

      <div id={contentId} hidden={!open}>
        {logs.length === 0 ? (
          <div className="atelier-section-empty">No chat requests yet — send a message in Coach to populate this log.</div>
        ) : (
          <div className="atelier-section-scroll">
            <table className="atelier-section-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Prompt</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <ChatRow key={log.id} log={log} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
