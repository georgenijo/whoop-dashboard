"use client";

import { useMemo, useState, useId } from "react";

type SyncLogRow = {
  id: number;
  started_at: string;
  duration_ms: number;
  status: string;
  recovery_count: number | null;
  sleep_count: number | null;
  workouts_count: number | null;
  details?: string | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNumberMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1])
    )
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
    ].some((v) => v !== null);
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
    timeZoneName: "short",
  });
}

function labelFor(key: string): string {
  return key.replace(/_/g, " ");
}

type TimingStep = { label: string; value: number; color: string };

function TimingBars({ steps }: { steps: TimingStep[] }) {
  if (steps.length === 0) return <div className="atelier-detail-muted">No timing data</div>;
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="atelier-timing-bars">
      {steps.map((step) => {
        const pct = step.value > 0 ? Math.max(2, (step.value / max) * 100) : 0;
        return (
          <div key={step.label} className="atelier-timing-row">
            <div className="atelier-timing-label">{step.label}</div>
            <div className="atelier-timing-track">
              <div className="atelier-timing-fill" style={{ width: `${pct}%`, background: step.color }} />
            </div>
            <div className="atelier-timing-value">{fmtDuration(step.value)}</div>
          </div>
        );
      })}
    </div>
  );
}

function SyncDetailPanel({ details }: { details: ParsedSyncDetails }) {
  const rawSteps: Array<{ label: string; value: number | null; color: string }> = [
    { label: "fetch", value: details.fetch_ms, color: "var(--mustard)" },
    { label: "sync db", value: details.sync_db_ms, color: "var(--olive)" },
    { label: "summary", value: details.summary_ms, color: "var(--coral)" },
    { label: "insight", value: details.insight_ms, color: "var(--ink-mute)" },
  ];
  const mainSteps: TimingStep[] = rawSteps.flatMap((s) =>
    s.value === null ? [] : [{ label: s.label, value: s.value, color: s.color }]
  );
  const fetchSteps: TimingStep[] = Object.entries(details.fetch_breakdown).map(
    ([label, value]) => ({ label: labelFor(label), value, color: "var(--ink-mute)" })
  );
  const pageCounts = Object.entries(details.page_counts);

  return (
    <div className="atelier-section-detail atelier-section-detail-grid">
      <div className="atelier-detail-col">
        <div className="atelier-detail-group">
          <div className="atelier-detail-label">Step timings</div>
          <TimingBars steps={mainSteps} />
        </div>
        <div className="atelier-detail-group">
          <div className="atelier-detail-label">Fetch breakdown</div>
          <TimingBars steps={fetchSteps} />
        </div>
      </div>

      <div className="atelier-detail-col">
        <div className="atelier-detail-group">
          <div className="atelier-detail-label">Run window</div>
          <div className="atelier-detail-metrics">
            <div className="atelier-detail-metric">
              <div className="atelier-detail-metric-label">Window</div>
              <div className="atelier-detail-metric-value">
                {details.window_days !== null ? `${details.window_days}d` : "—"}
              </div>
            </div>
          </div>
        </div>

        <div className="atelier-detail-group">
          <div className="atelier-detail-label">Page counts</div>
          {pageCounts.length === 0 ? (
            <div className="atelier-detail-muted">No page count data</div>
          ) : (
            <div className="atelier-detail-metrics">
              {pageCounts.map(([endpoint, count]) => (
                <div key={endpoint} className="atelier-detail-metric">
                  <div className="atelier-detail-metric-label">{labelFor(endpoint)}</div>
                  <div className="atelier-detail-metric-value">{count}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SyncRow({ log }: { log: SyncLogRow }) {
  const [open, setOpen] = useState(false);
  const details = useMemo(() => parseDetails(log.details), [log.details]);
  const hasDetails = details !== null;
  const detailsId = `atelier-sync-${log.id}`;

  return (
    <>
      <tr
        className={`atelier-section-row${hasDetails ? " clickable" : ""}${open ? " open" : ""}`}
        onClick={hasDetails ? () => setOpen((v) => !v) : undefined}
        aria-expanded={hasDetails ? open : undefined}
        aria-controls={hasDetails ? detailsId : undefined}
      >
        <td className="atelier-section-time">{fmtTime(log.started_at)}</td>
        <td className="atelier-section-dur">{fmtDuration(log.duration_ms)}</td>
        <td className="atelier-section-center">{log.recovery_count ?? "—"}</td>
        <td className="atelier-section-center">{log.sleep_count ?? "—"}</td>
        <td className="atelier-section-center">{log.workouts_count ?? "—"}</td>
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
          <td colSpan={7}>
            <SyncDetailPanel details={details} />
          </td>
        </tr>
      )}
    </>
  );
}

type Props = {
  logs: SyncLogRow[];
};

export default function AtelierSyncSection({ logs }: Props) {
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
          <span className="atelier-collapsible-index">II</span>
          <span className="atelier-collapsible-title">Sync history</span>
          <span className="atelier-collapsible-sub">{logs.length} syncs</span>
        </div>
        <svg aria-hidden="true" viewBox="0 0 16 16" className={`atelier-collapsible-chevron${open ? " open" : ""}`}>
          <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </svg>
      </button>

      <div id={contentId} hidden={!open}>
        {logs.length === 0 ? (
          <div className="atelier-section-empty">No syncs yet — tap the refresh icon in the top bar to pull fresh Whoop data.</div>
        ) : (
          <div className="atelier-section-scroll">
            <table className="atelier-section-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Duration</th>
                  <th>Recovery</th>
                  <th>Sleep</th>
                  <th>Workouts</th>
                  <th>Status</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <SyncRow key={log.id} log={log} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
