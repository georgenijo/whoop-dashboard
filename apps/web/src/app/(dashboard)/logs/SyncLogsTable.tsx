"use client";

import { useMemo, useState } from "react";
import { PARTIAL_ERROR_FALLBACK } from "@/lib/sync-meta";

type SyncLogRow = {
  id: number;
  started_at: string;
  duration_ms: number;
  status: "ok" | "error";
  recovery_count: number | null;
  sleep_count: number | null;
  workouts_count: number | null;
  error_message: string | null;
  source: string | null;
  details?: string | null;
  partial: boolean;
};

type ParsedSyncDetails = {
  fetch_ms: number | null;
  sync_db_ms: number | null;
  summary_ms: number | null;
  insight_ms: number | null;
  fetch_breakdown: Record<string, number>;
  page_counts: Record<string, number>;
  window_days: number | null;
};

type TimingStep = {
  label: string;
  value: number;
  color: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNumberMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => (
      typeof entry[1] === "number" && Number.isFinite(entry[1])
    ))
  );
}

function parseDetails(details?: string | null): ParsedSyncDetails | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details) as unknown;
    if (!isRecord(parsed)) return null;
    const result = {
      fetch_ms: readNumber(parsed.fetch_ms),
      sync_db_ms: readNumber(parsed.sync_db_ms),
      summary_ms: readNumber(parsed.summary_ms),
      insight_ms: readNumber(parsed.insight_ms),
      fetch_breakdown: readNumberMap(parsed.fetch_breakdown),
      page_counts: readNumberMap(parsed.page_counts),
      window_days: readNumber(parsed.window_days),
    };
    const hasTimings = [
      result.fetch_ms,
      result.sync_db_ms,
      result.summary_ms,
      result.insight_ms,
      result.window_days,
    ].some((value) => value !== null);
    if (
      !hasTimings &&
      Object.keys(result.fetch_breakdown).length === 0 &&
      Object.keys(result.page_counts).length === 0
    ) {
      return null;
    }
    return result;
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
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

function labelFor(key: string): string {
  return key.replace(/_/g, " ");
}

function MetricPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{
      minWidth: 110,
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

type BadgeStatus = SyncLogRow["status"] | "partial";

function StatusBadge({ status }: { status: BadgeStatus }) {
  const palette: Record<BadgeStatus, { bg: string; fg: string }> = {
    ok: { bg: "rgba(0,212,170,0.15)", fg: "#00d4aa" },
    partial: { bg: "rgba(255,170,0,0.15)", fg: "#ffaa00" },
    error: { bg: "rgba(255,107,107,0.15)", fg: "#ff6b6b" },
  };
  const { bg, fg } = palette[status];
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 4,
      fontSize: 11,
      fontFamily: "var(--font-mono)",
      background: bg,
      color: fg,
    }}>
      {status}
    </span>
  );
}

function TimingBars({ steps }: { steps: TimingStep[] }) {
  if (steps.length === 0) {
    return (
      <div style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
        No timing data
      </div>
    );
  }

  const max = Math.max(...steps.map((step) => step.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {steps.map((step) => {
        const dur = fmtDuration(step.value);
        const pct = step.value > 0 ? Math.max(2, (step.value / max) * 100) : 0;
        return (
          <div
            key={step.label}
            style={{
              display: "grid",
              gridTemplateColumns: "110px minmax(160px, 1fr) 74px",
              gap: 10,
              alignItems: "center",
            }}
          >
            <div style={{
              color: "var(--fg-2)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              textTransform: "capitalize",
            }}>
              {step.label}
            </div>
            <div style={{
              height: 8,
              borderRadius: 4,
              background: "rgba(255,255,255,0.06)",
              overflow: "hidden",
            }}>
              <div style={{
                width: `${pct}%`,
                height: "100%",
                borderRadius: 4,
                background: step.color,
              }} />
            </div>
            <div style={{
              color: dur.color,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
            }}>
              {dur.text}
            </div>
          </div>
        );
      })}
    </div>
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

function LogRow({ log }: { log: SyncLogRow }) {
  const [open, setOpen] = useState(false);
  const details = useMemo(() => parseDetails(log.details), [log.details]);
  const isPartial = log.partial === true;
  // Partial rows must always be expandable to surface the failure context,
  // even if `details` JSON failed to parse or carries no timings.
  const expandable = details !== null || isPartial;
  const dur = fmtDuration(log.duration_ms);
  const detailsId = `details-${log.id}`;
  const cell = {
    padding: "10px 16px",
    textAlign: "center" as const,
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--fg-2)",
    fontVariantNumeric: "tabular-nums" as const,
  };
  const rawSteps: Array<{ label: string; value: number | null; color: string }> = [
    { label: "fetch", value: details?.fetch_ms ?? null, color: "#7b61ff" },
    { label: "sync db", value: details?.sync_db_ms ?? null, color: "#00d4aa" },
    { label: "summary", value: details?.summary_ms ?? null, color: "#ffaa00" },
    { label: "insight", value: details?.insight_ms ?? null, color: "#ff6b6b" },
  ];
  const mainSteps: TimingStep[] = rawSteps.flatMap((step) => (
    step.value === null
      ? []
      : [{ label: step.label, value: step.value, color: step.color }]
  ));
  const fetchSteps = Object.entries(details?.fetch_breakdown ?? {}).map(
    ([label, value]) => ({
      label: labelFor(label),
      value,
      color: "#a08aff",
    })
  );
  const pageCounts = Object.entries(details?.page_counts ?? {});
  const effectiveStatus: BadgeStatus = isPartial ? "partial" : log.status;
  const showPartialError =
    isPartial &&
    log.error_message !== null &&
    log.error_message !== PARTIAL_ERROR_FALLBACK;

  return (
    <>
      <tr
        onClick={expandable ? () => setOpen((value) => !value) : undefined}
        aria-expanded={expandable ? open : undefined}
        aria-controls={expandable ? detailsId : undefined}
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          cursor: expandable ? "pointer" : "default",
        }}
      >
        <td style={{ padding: "10px 16px", color: "var(--fg-2)", fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "nowrap" }}>
          {fmtTime(log.started_at)}
        </td>
        <td style={{ padding: "10px 16px", textAlign: "right", color: dur.color, fontFamily: "var(--font-mono)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
          {dur.text}
        </td>
        <td style={cell}>{log.recovery_count ?? "-"}</td>
        <td style={cell}>{log.sleep_count ?? "-"}</td>
        <td style={cell}>{log.workouts_count ?? "-"}</td>
        <td style={cell}>{log.source ?? "-"}</td>
        <td style={{ padding: "10px 16px", textAlign: "center" }}>
          <StatusBadge status={effectiveStatus} />
        </td>
        <td style={{ padding: "10px 8px", textAlign: "center", width: 32 }}>
          {expandable ? <Chevron open={open} /> : null}
        </td>
      </tr>
      {open && expandable && (
        <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <td id={detailsId} colSpan={8} style={{ padding: "14px 20px", background: "rgba(255,255,255,0.02)" }}>
            {isPartial && (
              <div
                role="note"
                style={{
                  marginBottom: details ? 14 : 0,
                  padding: "10px 12px",
                  borderRadius: 6,
                  background: "rgba(255,170,0,0.08)",
                  border: "1px solid rgba(255,170,0,0.3)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                }}
              >
                <div style={{
                  color: "#ffaa00",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}>
                  Partial sync
                </div>
                {showPartialError && (
                  <div style={{
                    marginTop: 6,
                    color: "var(--fg-1)",
                    wordBreak: "break-word",
                  }}>
                    {log.error_message}
                  </div>
                )}
                <div style={{ marginTop: 6, color: "var(--fg-3)" }}>
                  Rows committed; post-commit step did not complete.
                </div>
              </div>
            )}
            {details && (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(340px, 1.2fr) minmax(280px, 1fr)", gap: 18, minWidth: 720 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <div style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase" }}>
                      Step timings
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <TimingBars steps={mainSteps} />
                    </div>
                  </div>

                  <div>
                    <div style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase" }}>
                      Fetch breakdown
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <TimingBars steps={fetchSteps} />
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <div style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase" }}>
                      Run window
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                      <MetricPill label="Window" value={details.window_days !== null ? `${details.window_days}d` : "-"} />
                    </div>
                  </div>

                  <div>
                    <div style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase" }}>
                      Page counts
                    </div>
                    {pageCounts.length === 0 ? (
                      <div style={{ marginTop: 8, color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        No page count data
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                        {pageCounts.map(([endpoint, count]) => (
                          <MetricPill
                            key={endpoint}
                            label={labelFor(endpoint)}
                            value={`${count} ${count === 1 ? "page" : "pages"}`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function SyncLogsTable({ logs }: { logs: SyncLogRow[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-sans)", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <th style={{ padding: "10px 16px", textAlign: "left", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>Time</th>
            <th style={{ padding: "10px 16px", textAlign: "right", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>Duration</th>
            <th style={{ padding: "10px 16px", textAlign: "center", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>Recovery</th>
            <th style={{ padding: "10px 16px", textAlign: "center", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>Sleep</th>
            <th style={{ padding: "10px 16px", textAlign: "center", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>Workouts</th>
            <th style={{ padding: "10px 16px", textAlign: "center", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>Source</th>
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
