"use client";

import { useState } from "react";

export type LedgerRow = {
  ts: string;
  kind: "Sync" | "Recovery" | "Sleep" | "Page" | "Chat" | "Error";
  summary: string;
  duration_ms: number | null;
  status: string;
  details?: string | null;
};

const FILTERS = ["All", "Sync", "Recovery", "Sleep", "Error"] as const;
type Filter = (typeof FILTERS)[number];

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function EventLedger({ rows }: { rows: LedgerRow[] }) {
  const [filter, setFilter] = useState<Filter>("All");
  const [expanded, setExpanded] = useState<number | null>(null);

  const filtered = filter === "All" ? rows : rows.filter((r) => r.kind === filter);
  const counts = FILTERS.reduce(
    (acc, f) => ({
      ...acc,
      [f]: f === "All" ? rows.length : rows.filter((r) => r.kind === f).length,
    }),
    {} as Record<string, number>
  );

  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

  function romanFor(idx: number): string {
    if (idx < ROMAN.length) return ROMAN[idx];
    return String(idx + 1);
  }

  return (
    <div className="atelier-log-section">
      <div className="atelier-log-toolbar">
        {FILTERS.map((f) => (
          <button
            key={f}
            className={`atelier-log-pill${filter === f ? " active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f}
            <span className="atelier-log-pill-count">{counts[f]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="atelier-log-empty">No events match this filter.</div>
      ) : (
        <table className="atelier-log-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Time</th>
              <th>Kind</th>
              <th>Summary</th>
              <th>Duration</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, idx) => {
              const isOpen = expanded === idx;
              const hasDetails = !!row.details;
              return (
                <>
                  <tr
                    key={idx}
                    className={`atelier-log-row atelier-log-kind-${row.kind.toLowerCase()}${hasDetails ? " clickable" : ""}${isOpen ? " open" : ""}`}
                    onClick={() => hasDetails && setExpanded(isOpen ? null : idx)}
                  >
                    <td className="atelier-log-idx">{romanFor(idx)}</td>
                    <td className="atelier-log-time">
                      <span className="atelier-log-date">{formatDate(row.ts)}</span>{" "}
                      {formatTime(row.ts)}
                    </td>
                    <td>
                      <span className={`atelier-log-tag atelier-log-tag-${row.kind.toLowerCase()}`}>
                        {row.kind}
                      </span>
                    </td>
                    <td className="atelier-log-summary">{row.summary}</td>
                    <td className="atelier-log-dur">{formatDuration(row.duration_ms)}</td>
                    <td className="atelier-log-status">{row.status}</td>
                  </tr>
                  {isOpen && hasDetails && (
                    <tr key={`${idx}-details`} className="atelier-log-detail-row">
                      <td colSpan={6}>
                        <pre className="atelier-log-detail-pre">{row.details}</pre>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
