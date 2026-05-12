"use client";

import { useMemo, useState } from "react";

type ChatLogRow = {
  id: number;
  started_at: string;
  prompt_preview: string;
  duration_ms: number;
  status: "ok" | "error" | "aborted";
  response_length: number;
  error_message: string | null;
  days_context: number | null;
  type: "cli" | "api" | null;
  source: "web" | "ios" | null;
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

function fmtDuration(ms: number): { text: string; color: string } {
  const s = ms / 1000;
  let color = "var(--fg-2)";
  if (s < 5) color = "#00d4aa";
  else if (s < 15) color = "#ffaa00";
  else color = "#ff6b6b";
  return { text: s < 1 ? `${ms}ms` : `${s.toFixed(1)}s`, color };
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

function DetailMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{
      minWidth: 120,
      padding: "8px 10px",
      borderRadius: 6,
      background: "rgba(255,255,255,0.035)",
      border: "1px solid rgba(255,255,255,0.05)",
    }}>
      <div style={{
        color: "var(--fg-3)",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}>
        {label}
      </div>
      <div style={{
        marginTop: 4,
        color: "var(--fg-1)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: ChatLogRow["source"] }) {
  if (!source) {
    return <span style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 12 }}>-</span>;
  }
  const styles = {
    web: { background: "rgba(82,145,255,0.15)", color: "#7fb0ff" },
    ios: { background: "rgba(123,97,255,0.15)", color: "#a08aff" },
    dev: { background: "rgba(255,255,255,0.06)", color: "var(--fg-2)" },
  }[source];

  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 4,
      fontSize: 11,
      fontFamily: "var(--font-mono)",
      background: styles.background,
      color: styles.color,
      textTransform: "uppercase",
    }}>
      {source}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      style={{
        width: 14,
        height: 14,
        color: "var(--fg-3)",
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform var(--dur-base)",
      }}
    >
      <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function LogRow({ log }: { log: ChatLogRow }) {
  const [open, setOpen] = useState(false);
  const details = useMemo(() => parseDetails(log.details), [log.details]);
  const hasDetails = details !== null;
  const dur = fmtDuration(log.duration_ms);
  const usage = details?.usage;
  const detailsId = `chat-details-${log.id}`;

  return (
    <>
      <tr
        onClick={hasDetails ? () => setOpen((value) => !value) : undefined}
        aria-expanded={hasDetails ? open : undefined}
        aria-controls={hasDetails ? detailsId : undefined}
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          cursor: hasDetails ? "pointer" : "default",
        }}
      >
        <td style={{ padding: "10px 16px", color: "var(--fg-2)", fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "nowrap" }}>
          {fmtTime(log.started_at)}
        </td>
        <td style={{ padding: "10px 16px", color: "var(--fg-1)", maxWidth: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {log.prompt_preview}
        </td>
        <td style={{ padding: "10px 16px", textAlign: "right", color: dur.color, fontFamily: "var(--font-mono)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
          {dur.text}
        </td>
        <td style={{ padding: "10px 16px", textAlign: "right", color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
          {log.response_length > 0 ? `${log.response_length}` : "-"}
        </td>
        <td style={{ padding: "10px 16px", textAlign: "center" }}>
          <SourceBadge source={log.source} />
        </td>
        <td style={{ padding: "10px 16px", textAlign: "center" }}>
          {log.type ? (
            <span style={{
              display: "inline-block",
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              background: log.type === "api" ? "rgba(123,97,255,0.15)" : "rgba(255,255,255,0.06)",
              color: log.type === "api" ? "#a08aff" : "var(--fg-2)",
              textTransform: "uppercase",
            }}>
              {log.type}
            </span>
          ) : (
            <span style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 12 }}>-</span>
          )}
        </td>
        <td style={{ padding: "10px 16px", textAlign: "center", color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
          {log.days_context && log.days_context < 9999 ? `${log.days_context}d` : "all"}
        </td>
        <td style={{ padding: "10px 16px", textAlign: "center" }}>
          <span style={{
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 4,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            background: log.status === "ok" ? "rgba(0,212,170,0.15)" : "rgba(255,107,107,0.15)",
            color: log.status === "ok" ? "#00d4aa" : "#ff6b6b",
          }}>
            {log.status}
          </span>
        </td>
        <td style={{ padding: "10px 8px", textAlign: "center", width: 32 }}>
          {hasDetails ? <Chevron open={open} /> : null}
        </td>
      </tr>
      {open && hasDetails && (
        <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <td id={detailsId} colSpan={9} style={{ padding: "14px 20px", background: "rgba(255,255,255,0.02)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 620 }}>
              <div>
                <div style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Full prompt
                </div>
                <div style={{ marginTop: 6, color: "var(--fg-1)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  {details?.full_prompt || log.prompt_preview}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <DetailMetric label="Iterations" value={details?.iterations ?? 0} />
                <DetailMetric label="Calls" value={usage?.calls ?? 0} />
                <DetailMetric label="Input" value={usage?.input_tokens_total ?? 0} />
                <DetailMetric label="Output" value={usage?.output_tokens_total ?? 0} />
                <DetailMetric label="Cache create" value={usage?.cache_creation_input_tokens_total ?? 0} />
                <DetailMetric label="Cache read" value={usage?.cache_read_input_tokens_total ?? 0} />
              </div>

              <div>
                <div style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Tools
                </div>
                {(details?.tools?.length ?? 0) === 0 ? (
                  <div style={{ marginTop: 6, color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    No tool calls
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                    {details?.tools?.map((tool, index) => {
                      const toolDur = fmtDuration(tool.duration_ms);
                      return (
                        <div
                          key={`${tool.name}-${index}`}
                          style={{
                            padding: 10,
                            borderRadius: 6,
                            background: "rgba(0,0,0,0.18)",
                            border: "1px solid rgba(255,255,255,0.05)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ color: "var(--fg-0)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                              {tool.name}
                            </span>
                            <span style={{ color: toolDur.color, fontFamily: "var(--font-mono)", fontSize: 11 }}>
                              {toolDur.text}
                            </span>
                            <span style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                              rows {tool.rows ?? "-"}
                            </span>
                            <span style={{
                              padding: "1px 6px",
                              borderRadius: 4,
                              fontFamily: "var(--font-mono)",
                              fontSize: 10,
                              background: tool.status === "ok" ? "rgba(0,212,170,0.15)" : "rgba(255,107,107,0.15)",
                              color: tool.status === "ok" ? "#00d4aa" : "#ff6b6b",
                            }}>
                              {tool.status}
                            </span>
                          </div>
                          <pre style={{
                            margin: "8px 0 0",
                            padding: 10,
                            overflowX: "auto",
                            borderRadius: 4,
                            background: "rgba(255,255,255,0.035)",
                            color: "var(--fg-2)",
                            fontFamily: "var(--font-mono)",
                            fontSize: 11,
                            lineHeight: 1.45,
                          }}>
                            {stringify(tool.input)}
                          </pre>
                          {tool.error ? (
                            <div style={{ marginTop: 8, color: "#ff6b6b", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                              {tool.error}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ChatLogsTable({ logs }: { logs: ChatLogRow[] }) {
  return (
    <div style={{ overflowX: "auto", margin: "0 -14px", padding: "0 14px" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-sans)", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <th style={{ padding: "10px 16px", textAlign: "left", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>Time</th>
            <th style={{ padding: "10px 16px", textAlign: "left", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>Prompt</th>
            <th style={{ padding: "10px 16px", textAlign: "right", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>Duration</th>
            <th style={{ padding: "10px 16px", textAlign: "right", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>Resp</th>
            <th style={{ padding: "10px 16px", textAlign: "center", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>Source</th>
            <th style={{ padding: "10px 16px", textAlign: "center", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>Type</th>
            <th style={{ padding: "10px 16px", textAlign: "center", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>Range</th>
            <th style={{ padding: "10px 16px", textAlign: "center", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>Status</th>
            <th style={{ padding: "10px 8px", width: 32 }} aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <LogRow key={log.id} log={log} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
