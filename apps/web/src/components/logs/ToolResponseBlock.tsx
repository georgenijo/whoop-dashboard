"use client";

import { useMemo, useState } from "react";

/**
 * Renders the response payload from a single Coach tool call inside the
 * /logs chat-call detail view. Switches on tool name to pick a treatment:
 *
 *   trigger_whoop_sync  — labelled key/value summary (success/skipped pill,
 *                         last_sync_at relative time, cooldown fields if
 *                         present) + collapsible JSON.
 *   query_recovery      — top-line `N rows · D1 → D2`, 5-row preview table
 *                         (date / recovery_score / hrv / rhr), JSON below.
 *   query_sleep         — same shape, columns (date / perf / duration / eff).
 *   query_strain        — same shape, columns (date / strain / kJ / avg_hr).
 *   query_workouts      — top-line `N workouts · D1 → D2`, compact list
 *                         (sport / strain / duration / date).
 *   query_journal       — top-line `N entries · D1 → D2`, date + first-line.
 *   query_naps          — same shape as sleep, naps-only.
 *   fallback            — pretty-printed JSON with copy button.
 *
 * Defaults: JSON > 500 chars starts collapsed; row tables start expanded
 * showing first 5 with "Show all N" toggle. Copy button on every block.
 *
 * Past chat_logs rows pre-dating the response capture in tools.ts will pass
 * `response === undefined` here — the component returns a muted "no response
 * data" notice so the existing input/duration block still renders cleanly.
 */
export default function ToolResponseBlock({
  toolName,
  response,
}: {
  toolName: string;
  response: unknown;
}) {
  if (response === undefined) {
    return (
      <div
        style={{
          marginTop: 8,
          padding: 8,
          borderRadius: 4,
          background: "rgba(255,255,255,0.02)",
          border: "1px dashed rgba(255,255,255,0.05)",
          color: "var(--fg-3)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          lineHeight: 1.45,
        }}
      >
        Response not captured for this historical call.
      </div>
    );
  }

  const truncated = isTruncatedMarker(response);

  switch (toolName) {
    case "trigger_whoop_sync":
      return <SyncResponse response={response} />;
    case "query_recovery":
      return (
        <RowsResponse
          response={response}
          rowLabel="rows"
          truncated={truncated}
          columns={[
            { key: "date", label: "date" },
            { key: "recovery_score", label: "score", align: "right" },
            { key: "hrv", label: "hrv", align: "right" },
            { key: "rhr", label: "rhr", align: "right" },
          ]}
        />
      );
    case "query_sleep":
      return (
        <RowsResponse
          response={response}
          rowLabel="rows"
          truncated={truncated}
          columns={[
            { key: "date", label: "date" },
            { key: "performance", label: "perf", align: "right" },
            { key: "in_bed_ms", label: "duration", align: "right", format: fmtDuration },
            { key: "efficiency", label: "efficiency", align: "right" },
          ]}
        />
      );
    case "query_strain":
      return (
        <RowsResponse
          response={response}
          rowLabel="rows"
          truncated={truncated}
          columns={[
            { key: "date", label: "date" },
            { key: "strain", label: "strain", align: "right" },
            { key: "kilojoule", label: "kJ", align: "right" },
            { key: "avg_hr", label: "avg_hr", align: "right" },
          ]}
        />
      );
    case "query_workouts":
      return (
        <WorkoutsResponse response={response} truncated={truncated} />
      );
    case "query_journal":
      return <JournalResponse response={response} truncated={truncated} />;
    case "query_naps":
      return (
        <RowsResponse
          response={response}
          rowLabel="naps"
          truncated={truncated}
          columns={[
            { key: "date", label: "date" },
            { key: "performance", label: "perf", align: "right" },
            { key: "duration_ms", label: "duration", align: "right", format: fmtDuration },
            { key: "efficiency", label: "efficiency", align: "right" },
          ]}
        />
      );
    default:
      return (
        <JsonResponse
          response={response}
          label="Response"
          defaultOpen
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Sync tool
// ---------------------------------------------------------------------------

type SyncResponseShape = {
  success?: boolean;
  skipped?: boolean;
  reason?: string;
  last_sync_at?: string;
  cooldown_seconds?: number;
  next_sync_allowed_at?: string;
  rows_inserted?: Record<string, number>;
  fetched_counts?: Record<string, number>;
  latest_recovery_date?: string;
  latest_sleep_date?: string;
  latest_strain_date?: string;
  error?: string;
  already_synced?: boolean;
};

function SyncResponse({ response }: { response: unknown }) {
  const data = (isRecord(response) ? response : {}) as SyncResponseShape;
  const skipped = data.skipped === true;
  const ok = data.success === true;
  const pillBg = !ok
    ? "rgba(255,107,107,0.15)"
    : skipped
      ? "rgba(255,170,0,0.15)"
      : "rgba(0,212,170,0.15)";
  const pillColor = !ok
    ? "#ff6b6b"
    : skipped
      ? "#ffaa00"
      : "#00d4aa";
  const pillLabel = !ok ? "failed" : skipped ? "skipped" : "success";

  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span
          style={{
            padding: "2px 8px",
            borderRadius: 4,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            background: pillBg,
            color: pillColor,
            textTransform: "uppercase",
          }}
        >
          {pillLabel}
        </span>
        {data.reason ? (
          <span style={{ color: "var(--fg-2)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
            {data.reason}
          </span>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", rowGap: 4, columnGap: 12 }}>
        {data.last_sync_at ? (
          <Field
            label="Last sync"
            value={`${fmtRelative(data.last_sync_at)} · ${data.last_sync_at}`}
          />
        ) : null}
        {data.cooldown_seconds !== undefined ? (
          <Field label="Cooldown" value={`${data.cooldown_seconds}s`} />
        ) : null}
        {data.next_sync_allowed_at ? (
          <Field
            label="Next allowed"
            value={`${fmtRelative(data.next_sync_allowed_at)} · ${data.next_sync_allowed_at}`}
          />
        ) : null}
        {data.latest_recovery_date ? (
          <Field label="Latest recovery" value={data.latest_recovery_date} />
        ) : null}
        {data.latest_sleep_date ? (
          <Field label="Latest sleep" value={data.latest_sleep_date} />
        ) : null}
        {data.latest_strain_date ? (
          <Field label="Latest strain" value={data.latest_strain_date} />
        ) : null}
        {data.error ? <Field label="Error" value={data.error} color="#ff6b6b" /> : null}
      </div>

      {data.rows_inserted || data.fetched_counts ? (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {data.rows_inserted ? (
            <CountGroup label="Rows inserted" counts={data.rows_inserted} />
          ) : null}
          {data.fetched_counts ? (
            <CountGroup label="Fetched" counts={data.fetched_counts} />
          ) : null}
        </div>
      ) : null}

      <JsonResponse response={response} label="Full JSON" defaultOpen={false} />
    </div>
  );
}

function CountGroup({ label, counts }: { label: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, v]) => typeof v === "number");
  if (entries.length === 0) return null;
  return (
    <div>
      <div style={subLabelStyle}>{label}</div>
      <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
        {entries.map(([k, v]) => (
          <span
            key={k}
            style={{
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(255,255,255,0.035)",
              border: "1px solid rgba(255,255,255,0.05)",
              color: "var(--fg-1)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
          >
            {k}: {v}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row-table responses (recovery / sleep / strain / naps)
// ---------------------------------------------------------------------------

type RowsColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
  format?: (v: unknown) => string;
};

function RowsResponse({
  response,
  rowLabel,
  truncated,
  columns,
}: {
  response: unknown;
  rowLabel: string;
  truncated: TruncatedInfo | null;
  columns: RowsColumn[];
}) {
  const { rows, totalCount } = extractRows(response, truncated);

  if (!rows) {
    // Truncated marker without preview, or non-array payload. Just dump JSON.
    return <JsonResponse response={response} label="Response" defaultOpen />;
  }

  const dateRange = computeDateRange(rows);
  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <SummaryLine
        count={totalCount}
        rowLabel={rowLabel}
        dateRange={dateRange}
        truncatedNote={truncated ? "preview only" : null}
      />
      <RowsTable rows={rows} columns={columns} totalCount={totalCount} />
      <JsonResponse response={response} label="Full JSON" defaultOpen={false} />
    </div>
  );
}

function RowsTable({
  rows,
  columns,
  totalCount,
}: {
  rows: Record<string, unknown>[];
  columns: RowsColumn[];
  totalCount: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, 5);
  const hasMore = rows.length > 5;
  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
        >
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.02)" }}>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    padding: "6px 10px",
                    textAlign: col.align ?? "left",
                    color: "var(--fg-3)",
                    fontWeight: 500,
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                {columns.map((col) => {
                  const raw = row[col.key];
                  const text = col.format ? col.format(raw) : fmtCell(raw);
                  return (
                    <td
                      key={col.key}
                      style={{
                        padding: "6px 10px",
                        textAlign: col.align ?? "left",
                        color: "var(--fg-1)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          style={toggleButtonStyle}
        >
          {showAll ? "Show first 5" : `Show all ${totalCount}`}
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workouts
// ---------------------------------------------------------------------------

function WorkoutsResponse({
  response,
  truncated,
}: {
  response: unknown;
  truncated: TruncatedInfo | null;
}) {
  // executeTool returns `{ rows, _meta }` for query_workouts. Handle both
  // that shape and a plain array (older payloads / truncation previews).
  let rows: Record<string, unknown>[] | null = null;
  let totalCount = 0;

  if (truncated && Array.isArray(truncated.preview)) {
    rows = truncated.preview.filter(isRecord);
    totalCount = truncated.total_count ?? truncated.preview.length;
  } else if (isRecord(response) && Array.isArray(response.rows)) {
    rows = response.rows.filter(isRecord);
    const meta = isRecord(response._meta) ? response._meta : null;
    totalCount =
      typeof meta?.total_count === "number" ? meta.total_count : rows.length;
  } else if (Array.isArray(response)) {
    rows = response.filter(isRecord);
    totalCount = rows.length;
  }

  if (!rows) {
    return <JsonResponse response={response} label="Response" defaultOpen />;
  }

  const dateRange = computeDateRange(rows);
  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <SummaryLine
        count={totalCount}
        rowLabel="workouts"
        dateRange={dateRange}
        truncatedNote={truncated ? "preview only" : null}
      />
      <RowsTable
        rows={rows}
        totalCount={totalCount}
        columns={[
          { key: "sport", label: "sport" },
          { key: "strain", label: "strain", align: "right" },
          { key: "duration_sec", label: "duration", align: "right", format: fmtSeconds },
          { key: "date", label: "date" },
        ]}
      />
      <JsonResponse response={response} label="Full JSON" defaultOpen={false} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

function JournalResponse({
  response,
  truncated,
}: {
  response: unknown;
  truncated: TruncatedInfo | null;
}) {
  // useState must run unconditionally before any early return — Rules of
  // Hooks. The "no journal rows" branch falls through to the JSON viewer
  // below with the toggle state unused but harmlessly initialised.
  const [showAll, setShowAll] = useState(false);
  const { rows, totalCount } = extractRows(response, truncated);
  if (!rows) {
    return <JsonResponse response={response} label="Response" defaultOpen />;
  }
  const dateRange = computeDateRange(rows);
  const visible = showAll ? rows : rows.slice(0, 5);
  const hasMore = rows.length > 5;

  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <SummaryLine
        count={totalCount}
        rowLabel="entries"
        dateRange={dateRange}
        truncatedNote={truncated ? "preview only" : null}
      />
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {visible.map((row, i) => {
          const date = typeof row.date === "string" ? row.date : "—";
          const body =
            typeof row.body === "string"
              ? row.body
              : typeof row.content === "string"
                ? row.content
                : "";
          const firstLine = body.split(/\r?\n/)[0]?.trim().slice(0, 140) ?? "";
          return (
            <li
              key={i}
              style={{
                padding: "6px 10px",
                borderRadius: 4,
                background: "rgba(255,255,255,0.025)",
                display: "flex",
                gap: 10,
                alignItems: "baseline",
              }}
            >
              <span style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 11, minWidth: 90 }}>
                {date}
              </span>
              <span style={{ color: "var(--fg-1)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                {firstLine || <em style={{ color: "var(--fg-3)" }}>empty</em>}
              </span>
            </li>
          );
        })}
      </ul>
      {hasMore ? (
        <button type="button" onClick={() => setShowAll((v) => !v)} style={toggleButtonStyle}>
          {showAll ? "Show first 5" : `Show all ${totalCount}`}
        </button>
      ) : null}
      <JsonResponse response={response} label="Full JSON" defaultOpen={false} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// JSON viewer with copy-to-clipboard
// ---------------------------------------------------------------------------

function JsonResponse({
  response,
  label,
  defaultOpen,
}: {
  response: unknown;
  label: string;
  defaultOpen: boolean;
}) {
  const serialized = useMemo(() => {
    try {
      return JSON.stringify(response, null, 2);
    } catch {
      return String(response);
    }
  }, [response]);
  // Long payloads collapse by default; short ones (under 500 chars JSON) ride
  // the caller's default.
  const heuristicallyOpen = defaultOpen && serialized.length <= 500;
  const [open, setOpen] = useState(heuristicallyOpen);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={toggleButtonStyle}
          aria-expanded={open}
        >
          {open ? `Hide ${label}` : `Show ${label}`}
        </button>
        <CopyButton text={serialized} />
        <span style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 10 }}>
          {serialized.length} chars
        </span>
      </div>
      {open ? (
        <pre
          style={{
            margin: "8px 0 0",
            padding: 10,
            maxHeight: 360,
            overflow: "auto",
            borderRadius: 4,
            background: "rgba(0,0,0,0.25)",
            color: "var(--fg-1)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            lineHeight: 1.45,
          }}
        >
          {serialized}
        </pre>
      ) : null}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          // Older Safari / non-secure-context fallback isn't worth shipping —
          // /logs is always served over HTTPS behind CF Access. If the
          // Clipboard API is unavailable we just silently no-op.
          if (typeof navigator !== "undefined" && navigator.clipboard) {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        } catch {
          // Permission denied or transient failure — surface as "failed" so
          // the user knows to copy by hand.
          setCopied(false);
        }
      }}
      style={{
        ...toggleButtonStyle,
        background: copied ? "rgba(0,212,170,0.15)" : toggleButtonStyle.background,
        color: copied ? "#00d4aa" : toggleButtonStyle.color,
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const subLabelStyle: React.CSSProperties = {
  color: "var(--fg-3)",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const toggleButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "3px 8px",
  borderRadius: 4,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.06)",
  color: "var(--fg-2)",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  cursor: "pointer",
};

function Field({
  label,
  value,
  color = "var(--fg-1)",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <>
      <div style={subLabelStyle}>{label}</div>
      <div
        style={{
          color,
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>
    </>
  );
}

function SummaryLine({
  count,
  rowLabel,
  dateRange,
  truncatedNote,
}: {
  count: number;
  rowLabel: string;
  dateRange: string | null;
  truncatedNote: string | null;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
        color: "var(--fg-2)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <span>
        <strong style={{ color: "var(--fg-0)" }}>{count}</strong> {rowLabel}
      </span>
      {dateRange ? <span>· {dateRange}</span> : null}
      {truncatedNote ? (
        <span style={{ color: "#ffaa00" }}>· {truncatedNote}</span>
      ) : null}
    </div>
  );
}

type TruncatedInfo = {
  _truncated: true;
  total_count?: number;
  preview?: unknown[];
  size_chars?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTruncatedMarker(value: unknown): TruncatedInfo | null {
  if (!isRecord(value)) return null;
  if (value._truncated !== true) return null;
  const tc = value.total_count;
  const preview = value.preview;
  const sc = value.size_chars;
  return {
    _truncated: true,
    total_count: typeof tc === "number" ? tc : undefined,
    preview: Array.isArray(preview) ? preview : undefined,
    size_chars: typeof sc === "number" ? sc : undefined,
  };
}

function extractRows(
  response: unknown,
  truncated: TruncatedInfo | null
): { rows: Record<string, unknown>[] | null; totalCount: number } {
  if (truncated) {
    if (truncated.preview && truncated.preview.length > 0) {
      const rows = truncated.preview.filter(isRecord);
      return { rows, totalCount: truncated.total_count ?? rows.length };
    }
    return { rows: null, totalCount: truncated.total_count ?? 0 };
  }
  if (Array.isArray(response)) {
    const rows = response.filter(isRecord);
    return { rows, totalCount: rows.length };
  }
  // Some tools wrap rows in { rows, _meta } — handled by callers that care.
  if (isRecord(response) && Array.isArray(response.rows)) {
    const rows = response.rows.filter(isRecord);
    return { rows, totalCount: rows.length };
  }
  return { rows: null, totalCount: 0 };
}

function computeDateRange(rows: Record<string, unknown>[]): string | null {
  const dates = rows
    .map((r) => (typeof r.date === "string" ? r.date : null))
    .filter((d): d is string => !!d);
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return first === last ? first : `${first} → ${last}`;
}

function fmtCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    if (Math.abs(value) >= 100) return value.toFixed(0);
    if (Math.abs(value) >= 10) return value.toFixed(1);
    return value.toFixed(2);
  }
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
}

function fmtDuration(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const totalSec = Math.round(value / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtSeconds(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const totalSec = Math.round(value);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const deltaSec = Math.round((Date.now() - t) / 1000);
  const abs = Math.abs(deltaSec);
  const suffix = deltaSec >= 0 ? "ago" : "from now";
  if (abs < 60) return `${abs}s ${suffix}`;
  if (abs < 3600) return `${Math.round(abs / 60)}m ${suffix}`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h ${suffix}`;
  return `${Math.round(abs / 86400)}d ${suffix}`;
}
