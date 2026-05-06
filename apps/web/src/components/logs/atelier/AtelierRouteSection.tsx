"use client";

import { useMemo, useState, useId } from "react";

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
    timeZoneName: "short",
  });
}

function statusBadgeClass(status: number): string {
  if (status >= 200 && status < 400) return "ok";
  if (status >= 400 && status < 500) return "warn";
  return "error";
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

function RouteDetailPanel({ log, details }: { log: RouteLogRow; details: RouteDetails | null }) {
  return (
    <div className="atelier-section-detail atelier-section-detail-grid">
      <div className="atelier-detail-col">
        <div className="atelier-detail-metrics">
          <div className="atelier-detail-metric">
            <div className="atelier-detail-metric-label">Method</div>
            <div className="atelier-detail-metric-value">{details?.method ?? "—"}</div>
          </div>
          <div className="atelier-detail-metric">
            <div className="atelier-detail-metric-label">Status</div>
            <div className="atelier-detail-metric-value">{log.status}</div>
          </div>
          <div className="atelier-detail-metric">
            <div className="atelier-detail-metric-label">Duration</div>
            <div className="atelier-detail-metric-value">{fmtDuration(log.duration_ms)}</div>
          </div>
          <div className="atelier-detail-metric">
            <div className="atelier-detail-metric-label">Navigation</div>
            <div className="atelier-detail-metric-value">{navigationLabel(details)}</div>
          </div>
        </div>

        <div className="atelier-detail-lines">
          <div className="atelier-detail-line">
            <span className="atelier-detail-line-label">Route</span>
            <span className="atelier-detail-line-value">{log.route}</span>
          </div>
          <div className="atelier-detail-line">
            <span className="atelier-detail-line-label">Query</span>
            <span className={`atelier-detail-line-value${!details?.query_string ? " muted" : ""}`}>
              {details ? (details.query_string || "None") : "Not captured"}
            </span>
          </div>
          <div className="atelier-detail-line">
            <span className="atelier-detail-line-label">Referrer</span>
            <span className={`atelier-detail-line-value${!details?.referrer ? " muted" : ""}`}>
              {captured(details?.referrer)}
            </span>
          </div>
          <div className="atelier-detail-line">
            <span className="atelier-detail-line-label">User agent</span>
            <span className={`atelier-detail-line-value${!details?.user_agent ? " muted" : ""}`}>
              {captured(details?.user_agent)}
            </span>
          </div>
        </div>
      </div>

      <div className="atelier-detail-col">
        <div className="atelier-detail-lines">
          <div className="atelier-detail-line">
            <span className="atelier-detail-line-label">UA class</span>
            <span className={`atelier-detail-line-value${!details?.user_agent_class ? " muted" : ""}`}>
              {details?.user_agent_class ?? "Not captured"}
            </span>
          </div>
          <div className="atelier-detail-line">
            <span className="atelier-detail-line-label">Response size</span>
            <span className="atelier-detail-line-value muted">Not captured</span>
          </div>
          <div className="atelier-detail-line">
            <span className="atelier-detail-line-label">Server timing</span>
            <span className="atelier-detail-line-value muted">Not captured</span>
          </div>
          <div className="atelier-detail-line">
            <span className="atelier-detail-line-label">Cache / render</span>
            <span className="atelier-detail-line-value muted">Not captured</span>
          </div>
        </div>
        {!details && (
          <div className="atelier-detail-notice">
            Metadata was not captured for this historical render.
          </div>
        )}
      </div>
    </div>
  );
}

function RouteRow({ log }: { log: RouteLogRow }) {
  const [open, setOpen] = useState(false);
  const details = useMemo(() => parseDetails(log.details), [log.details]);
  const detailsId = `atelier-route-${log.id}`;

  return (
    <>
      <tr
        className={`atelier-section-row clickable${open ? " open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={detailsId}
      >
        <td className="atelier-section-time">{fmtTime(log.started_at)}</td>
        <td className="atelier-section-primary">{log.route}</td>
        <td className="atelier-section-dur">{fmtDuration(log.duration_ms)}</td>
        <td className="atelier-section-status">
          <span className={`atelier-section-badge atelier-section-badge-${statusBadgeClass(log.status)}`}>
            {log.status}
          </span>
        </td>
        <td className="atelier-section-chevron-cell">
          <svg aria-hidden="true" viewBox="0 0 16 16" className={`atelier-section-chevron${open ? " open" : ""}`}>
            <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
          </svg>
        </td>
      </tr>
      {open && (
        <tr id={detailsId} className="atelier-section-detail-row">
          <td colSpan={5}>
            <RouteDetailPanel log={log} details={details} />
          </td>
        </tr>
      )}
    </>
  );
}

type Props = {
  logs: RouteLogRow[];
};

export default function AtelierRouteSection({ logs }: Props) {
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
          <span className="atelier-collapsible-index">III</span>
          <span className="atelier-collapsible-title">Page render history</span>
          <span className="atelier-collapsible-sub">{logs.length} renders</span>
        </div>
        <svg aria-hidden="true" viewBox="0 0 16 16" className={`atelier-collapsible-chevron${open ? " open" : ""}`}>
          <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </svg>
      </button>

      <div id={contentId} hidden={!open}>
        {logs.length === 0 ? (
          <div className="atelier-section-empty">No page renders yet — refresh a dashboard page to populate this log.</div>
        ) : (
          <div className="atelier-section-scroll">
            <table className="atelier-section-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Route</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <RouteRow key={log.id} log={log} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
