"use client";

import { useMemo, useState } from "react";

type RouteLogRow = {
  id: number;
  started_at: string;
  route: string;
  duration_ms: number;
  status: number;
  details?: string | null;
};

type RouteDetails = {
  method: string | null;
  query_string: string | null;
  referrer: string | null;
  referrer_internal: boolean | null;
  user_agent_class: string | null;
  user_agent: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseDetails(details?: string | null): RouteDetails | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details) as unknown;
    if (!isRecord(parsed)) return null;
    return {
      method: readString(parsed.method),
      query_string: readString(parsed.query_string),
      referrer: readString(parsed.referrer),
      referrer_internal: readBoolean(parsed.referrer_internal),
      user_agent_class: readString(parsed.user_agent_class),
      user_agent: readString(parsed.user_agent),
    };
  } catch {
    return null;
  }
}

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
    timeZoneName: "short",
  });
}

function statusColor(status: number): { background: string; color: string } {
  if (status >= 200 && status < 400) {
    return { background: "rgba(0,212,170,0.15)", color: "#00d4aa" };
  }
  if (status >= 400 && status < 500) {
    return { background: "rgba(255,170,0,0.15)", color: "#ffaa00" };
  }
  return { background: "rgba(255,107,107,0.15)", color: "#ff6b6b" };
}

function captured(value: string | null | undefined): string {
  return value && value.length > 0 ? value : "Not captured";
}

function navigationLabel(details: RouteDetails | null): string {
  if (!details) return "Not captured";
  if (!details.referrer) return "Direct";
  if (details.referrer_internal === true) return "Internal";
  if (details.referrer_internal === false) return "External";
  return "Unknown";
}

function MetricPill({ label, value }: { label: string; value: string | number }) {
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

function StatusBadge({ status }: { status: number }) {
  const colors = statusColor(status);
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 4,
      fontSize: 11,
      fontFamily: "var(--font-mono)",
      background: colors.background,
      color: colors.color,
    }}>
      {status}
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

function LogRow({ log }: { log: RouteLogRow }) {
  const [open, setOpen] = useState(false);
  const details = useMemo(() => parseDetails(log.details), [log.details]);
  const dur = fmtDuration(log.duration_ms);
  const detailsId = `route-details-${log.id}`;

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
          {fmtTime(log.started_at)}
        </td>
        <td style={{ padding: "10px 16px", color: "var(--fg-1)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
          {log.route}
        </td>
        <td style={{ padding: "10px 16px", textAlign: "right", color: dur.color, fontFamily: "var(--font-mono)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
          {dur.text}
        </td>
        <td style={{ padding: "10px 16px", textAlign: "center" }}>
          <StatusBadge status={log.status} />
        </td>
        <td style={{ padding: "10px 8px", textAlign: "center", width: 32 }}>
          <Chevron open={open} />
        </td>
      </tr>
      {open && (
        <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <td id={detailsId} colSpan={5} style={{ padding: "14px 20px", background: "rgba(255,255,255,0.02)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1fr) minmax(320px, 1fr)", gap: 18, minWidth: 720 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <MetricPill label="Method" value={details?.method || "Not captured"} />
                  <MetricPill label="Duration" value={dur.text} />
                  <MetricPill label="Status" value={log.status} />
                  <MetricPill label="Navigation" value={navigationLabel(details)} />
                </div>

                <DetailLine label="Route" value={log.route} />
                <DetailLine
                  label="Query"
                  value={details ? details.query_string || "None" : "Not captured"}
                  muted={!details?.query_string}
                />
                <DetailLine
                  label="Referrer"
                  value={captured(details?.referrer)}
                  muted={!details?.referrer}
                />
                <DetailLine
                  label="User agent"
                  value={captured(details?.user_agent)}
                  muted={!details?.user_agent}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <DetailLine
                  label="UA class"
                  value={details?.user_agent_class ?? "Not captured"}
                  muted={!details?.user_agent_class}
                />
                <DetailLine label="Response size" value="Not captured" muted />
                <DetailLine label="Server timing" value="Not captured" muted />
                <DetailLine label="Cache / render" value="Not captured" muted />
                {!details ? (
                  <div style={{
                    marginTop: 2,
                    padding: 10,
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.035)",
                    border: "1px solid rgba(255,255,255,0.05)",
                    color: "var(--fg-3)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    lineHeight: 1.45,
                  }}>
                    Metadata was not captured for this historical render.
                  </div>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function RouteLogsTable({ logs }: { logs: RouteLogRow[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-sans)", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <th style={{ padding: "10px 16px", textAlign: "left", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>Time</th>
            <th style={{ padding: "10px 16px", textAlign: "left", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>Route</th>
            <th style={{ padding: "10px 16px", textAlign: "right", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>Duration</th>
            <th style={{ padding: "10px 16px", textAlign: "center", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>Status</th>
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
