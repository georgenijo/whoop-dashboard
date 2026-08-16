"use client";

import { useMemo, useState } from "react";

type ClientLogRow = {
  id: number;
  created_at: string;
  source: "web" | "ios";
  level: "info" | "warn" | "error";
  kind: "error" | "pageview" | "click" | "lifecycle" | "event";
  message: string;
  details: string | null;
  user_agent: string | null;
  app_version: string | null;
};

// Fields the CSP violation collector (ClientLogBootstrap, issue #501) puts in
// `details` for message === "csp-violation". Everything else falls back to
// raw JSON.
type CspDetails = {
  disposition: string | null;
  directive: string | null;
  blocked_uri: string | null;
  document_uri: string | null;
  source_file: string | null;
  line: number | null;
  column: number | null;
  sample: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCspDetails(details: string | null): CspDetails | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details) as unknown;
    if (!isRecord(parsed)) return null;
    return {
      disposition: readString(parsed.disposition),
      directive: readString(parsed.directive),
      blocked_uri: readString(parsed.blocked_uri),
      document_uri: readString(parsed.document_uri),
      source_file: readString(parsed.source_file),
      line: readNumber(parsed.line),
      column: readNumber(parsed.column),
      sample: readString(parsed.sample),
    };
  } catch {
    return null;
  }
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
    timeZoneName: "short",
  });
}

function levelColor(level: ClientLogRow["level"]): { background: string; color: string } {
  if (level === "error") return { background: "rgba(255,107,107,0.15)", color: "#ff6b6b" };
  if (level === "warn") return { background: "rgba(255,170,0,0.15)", color: "#ffaa00" };
  return { background: "rgba(255,255,255,0.06)", color: "var(--fg-2)" };
}

function Badge({ text, background, color }: { text: string; background: string; color: string }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 4,
      fontSize: 11,
      fontFamily: "var(--font-mono)",
      background,
      color,
      whiteSpace: "nowrap",
    }}>
      {text}
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

function DetailLine({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "130px minmax(220px, 1fr)",
      gap: 12,
      alignItems: "baseline",
    }}>
      <div style={{
        color: "var(--fg-3)",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        textTransform: "uppercase",
      }}>
        {label}
      </div>
      <div style={{
        color: muted ? "var(--fg-3)" : "var(--fg-1)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        lineHeight: 1.45,
        overflowWrap: "anywhere",
      }}>
        {value}
      </div>
    </div>
  );
}

function LogRow({ log }: { log: ClientLogRow }) {
  const [open, setOpen] = useState(false);
  const isCsp = log.message === "csp-violation";
  const csp = useMemo(() => (isCsp ? parseCspDetails(log.details) : null), [isCsp, log.details]);
  const detailsId = `client-log-details-${log.id}`;
  const levelColors = levelColor(log.level);

  return (
    <>
      <tr
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={detailsId}
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          cursor: "pointer",
        }}
      >
        <td style={{ padding: "10px 16px", color: "var(--fg-2)", fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "nowrap" }}>
          {fmtTime(log.created_at)}
        </td>
        <td style={{ padding: "10px 16px", textAlign: "center" }}>
          <Badge text={log.level} background={levelColors.background} color={levelColors.color} />
        </td>
        <td style={{ padding: "10px 16px", color: "var(--fg-1)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
          {isCsp && csp?.directive ? `csp-violation (${csp.directive})` : log.message}
        </td>
        <td style={{ padding: "10px 16px", color: "var(--fg-2)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
          {log.source}
        </td>
        <td style={{ padding: "10px 8px", textAlign: "center", width: 32 }}>
          <Chevron open={open} />
        </td>
      </tr>
      {open && (
        <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <td id={detailsId} colSpan={5} style={{ padding: "14px 20px", background: "rgba(255,255,255,0.02)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {isCsp && csp ? (
                <>
                  <DetailLine label="Disposition" value={csp.disposition ?? "Unknown"} muted={!csp.disposition} />
                  <DetailLine label="Directive" value={csp.directive ?? "Unknown"} muted={!csp.directive} />
                  <DetailLine label="Blocked URI" value={csp.blocked_uri ?? "Unknown"} muted={!csp.blocked_uri} />
                  <DetailLine label="Document" value={csp.document_uri ?? "Unknown"} muted={!csp.document_uri} />
                  {csp.source_file ? (
                    <DetailLine
                      label="Source"
                      value={`${csp.source_file}${csp.line ? `:${csp.line}` : ""}${csp.column ? `:${csp.column}` : ""}`}
                    />
                  ) : null}
                  {csp.sample ? <DetailLine label="Sample" value={csp.sample} /> : null}
                </>
              ) : (
                <DetailLine label="Details" value={log.details ?? "None"} muted={!log.details} />
              )}
              <DetailLine label="User agent" value={log.user_agent ?? "Not captured"} muted={!log.user_agent} />
              <DetailLine label="App version" value={log.app_version ?? "Not captured"} muted={!log.app_version} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ClientLogsTable({ logs }: { logs: ClientLogRow[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-sans)", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <th style={{ padding: "10px 16px", textAlign: "left", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>Time</th>
            <th style={{ padding: "10px 16px", textAlign: "center", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>Level</th>
            <th style={{ padding: "10px 16px", textAlign: "left", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>Message</th>
            <th style={{ padding: "10px 16px", textAlign: "left", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>Source</th>
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
