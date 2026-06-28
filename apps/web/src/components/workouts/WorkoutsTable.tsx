"use client";

import Link from "next/link";
import type { WorkoutRow } from "@/lib/db";

type Props = { rows: WorkoutRow[] };

const ZONES = [
  { key: "zone_0_ms" as const, label: "Z0", color: "#1e3a8a" },
  { key: "zone_1_ms" as const, label: "Z1", color: "#2563eb" },
  { key: "zone_2_ms" as const, label: "Z2", color: "#06b6d4" },
  { key: "zone_3_ms" as const, label: "Z3", color: "#facc15" },
  { key: "zone_4_ms" as const, label: "Z4", color: "#f97316" },
  { key: "zone_5_ms" as const, label: "Z5", color: "#b91c1c" },
];

// Shared column template so the header and every row line up. Last two tracks
// are the at-a-glance mini zone-bar + chevron affordance.
const GRID_COLUMNS = "96px 1fr 72px 56px 72px 72px 56px 132px 16px";

function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMinutes(ms: number | null): string {
  if (ms == null || ms <= 0) return "0m";
  const min = ms / 60_000;
  if (min < 1) return `${Math.round(ms / 1000)}s`;
  return `${min.toFixed(min >= 10 ? 0 : 1)}m`;
}

const HEADERS = ["Date", "Sport", "Duration", "Strain", "Avg HR", "Max HR", "kcal"];

export default function WorkoutsTable({ rows }: Props) {
  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <div className="card-head">
        <div className="card-title">
          <span className="dot" style={{ background: "#ffaa00", color: "#ffaa00" }} />
          Recent workouts
        </div>
        <span className="card-sub">{rows.length} sessions</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">
          <div className="title">No workouts in range</div>
          <div className="sub">Adjust the date range or sync Whoop</div>
        </div>
      ) : (
        <div style={{ minWidth: 760, fontFamily: "var(--font-mono)", fontSize: 12 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID_COLUMNS,
              gap: 10,
              alignItems: "center",
              padding: "6px 10px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {HEADERS.map((h) => (
              <span
                key={h}
                style={{
                  color: "var(--fg-3)",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  fontSize: 10,
                }}
              >
                {h}
              </span>
            ))}
            <span aria-hidden style={{ color: "var(--fg-3)", fontSize: 10, letterSpacing: "0.1em" }}>
              ZONES
            </span>
            <span aria-hidden />
          </div>
          {rows.map((w) => (
            <WorkoutRowItem key={w.id} workout={w} />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkoutRowItem({ workout: w }: { workout: WorkoutRow }) {
  const totalZoneMs = ZONES.reduce((sum, z) => sum + (w[z.key] ?? 0), 0);
  const zonesPresent = totalZoneMs > 0;

  return (
    <Link
      href={`/workouts/${w.id}`}
      aria-label={`View ${w.sport ?? "workout"} on ${formatDate(w.date)}`}
      style={{
        display: "grid",
        gridTemplateColumns: GRID_COLUMNS,
        gap: 10,
        alignItems: "center",
        padding: "8px 10px",
        borderBottom: "1px solid rgba(255,255,255,0.03)",
        color: "inherit",
        textDecoration: "none",
      }}
    >
      <span style={{ color: "var(--fg-2)" }}>{formatDate(w.date)}</span>
      <span
        style={{
          color: "var(--fg-0)",
          fontWeight: 500,
          fontFamily: "var(--font-sans)",
        }}
      >
        {w.sport ?? "—"}
      </span>
      <span style={{ color: "var(--fg-1)" }}>{formatDuration(w.duration_sec)}</span>
      <span style={{ color: "#ffaa00", fontWeight: 600 }}>{w.strain?.toFixed(1) ?? "—"}</span>
      <span style={{ color: "var(--fg-1)" }}>{w.avg_hr != null ? `${w.avg_hr} bpm` : "—"}</span>
      <span style={{ color: "var(--fg-1)" }}>{w.max_hr != null ? `${w.max_hr} bpm` : "—"}</span>
      <span style={{ color: "var(--fg-2)" }}>
        {w.kilojoule != null ? `${(w.kilojoule * 0.239).toFixed(0)}` : "—"}
      </span>

      {zonesPresent ? (
        <span
          style={{
            display: "flex",
            width: "100%",
            height: 8,
            borderRadius: 4,
            overflow: "hidden",
            background: "rgba(255,255,255,0.04)",
          }}
        >
          {ZONES.map((z) => {
            const ms = w[z.key] ?? 0;
            const pct = totalZoneMs > 0 ? (ms / totalZoneMs) * 100 : 0;
            if (pct <= 0) return null;
            return (
              <span
                key={z.label}
                title={`${z.label}: ${formatMinutes(ms)}`}
                style={{ width: `${pct}%`, background: z.color }}
              />
            );
          })}
        </span>
      ) : (
        <span style={{ color: "var(--fg-3)", fontSize: 10 }}>no zone data</span>
      )}

      <span
        aria-hidden
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--fg-3)" }}
      >
        <svg
          viewBox="0 0 16 16"
          style={{ width: 12, height: 12 }}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
      </span>
    </Link>
  );
}
