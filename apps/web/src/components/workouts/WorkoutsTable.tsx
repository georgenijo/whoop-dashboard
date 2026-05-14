"use client";

import { useId, useState } from "react";
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
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <th aria-hidden="true" style={{ width: 24 }} />
              {["Date", "Sport", "Duration", "Strain", "Avg HR", "Max HR", "kcal"].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    padding: "6px 10px",
                    color: "var(--fg-3)",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    fontSize: 10,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <WorkoutRowItem key={w.id} workout={w} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function WorkoutRowItem({ workout: w }: { workout: WorkoutRow }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();

  const totalZoneMs = ZONES.reduce((sum, z) => sum + (w[z.key] ?? 0), 0);
  const zonesPresent = totalZoneMs > 0;

  return (
    <>
      <tr
        style={{
          borderBottom: open
            ? "1px solid rgba(255,255,255,0.06)"
            : "1px solid rgba(255,255,255,0.03)",
        }}
      >
        <td style={{ padding: 0 }}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailId}
            aria-label={`${open ? "Collapse" : "Expand"} workout on ${formatDate(w.date)}`}
            onClick={() => setOpen((v) => !v)}
            style={{
              width: 24,
              height: 28,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: 0,
              cursor: "pointer",
              color: "var(--fg-3)",
              padding: 0,
            }}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              style={{
                width: 12,
                height: 12,
                transform: open ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform var(--dur-base)",
              }}
            >
              <path
                d="M6 4l4 4-4 4"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
            </svg>
          </button>
        </td>
        <td style={{ padding: "8px 10px", color: "var(--fg-2)" }}>{formatDate(w.date)}</td>
        <td
          style={{
            padding: "8px 10px",
            color: "var(--fg-0)",
            fontWeight: 500,
            fontFamily: "var(--font-sans)",
          }}
        >
          {w.sport ?? "—"}
        </td>
        <td style={{ padding: "8px 10px", color: "var(--fg-1)" }}>
          {formatDuration(w.duration_sec)}
        </td>
        <td style={{ padding: "8px 10px", color: "#ffaa00", fontWeight: 600 }}>
          {w.strain?.toFixed(1) ?? "—"}
        </td>
        <td style={{ padding: "8px 10px", color: "var(--fg-1)" }}>
          {w.avg_hr != null ? `${w.avg_hr} bpm` : "—"}
        </td>
        <td style={{ padding: "8px 10px", color: "var(--fg-1)" }}>
          {w.max_hr != null ? `${w.max_hr} bpm` : "—"}
        </td>
        <td style={{ padding: "8px 10px", color: "var(--fg-2)" }}>
          {w.kilojoule != null ? `${(w.kilojoule * 0.239).toFixed(0)}` : "—"}
        </td>
      </tr>
      {open && (
        <tr id={detailId} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
          <td colSpan={8} style={{ padding: "12px 16px 16px 32px", background: "rgba(255,255,255,0.015)" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                gap: 12,
                marginBottom: zonesPresent ? 12 : 0,
              }}
            >
              <DetailCell label="Sport" value={w.sport ?? "—"} />
              <DetailCell label="Duration" value={formatDuration(w.duration_sec)} />
              <DetailCell
                label="Avg HR"
                value={w.avg_hr != null ? `${w.avg_hr} bpm` : "—"}
              />
              <DetailCell
                label="Max HR"
                value={w.max_hr != null ? `${w.max_hr} bpm` : "—"}
              />
              <DetailCell
                label="kJ"
                value={w.kilojoule != null ? w.kilojoule.toFixed(0) : "—"}
              />
              <DetailCell
                label="Distance"
                value={
                  w.distance_m != null && w.distance_m > 0
                    ? `${(w.distance_m / 1000).toFixed(2)} km`
                    : "—"
                }
              />
            </div>

            {zonesPresent ? (
              <div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--fg-3)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    marginBottom: 6,
                  }}
                >
                  HR zones
                </div>
                <div
                  style={{
                    display: "flex",
                    width: "100%",
                    height: 8,
                    borderRadius: 4,
                    overflow: "hidden",
                    marginBottom: 8,
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
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(6, 1fr)",
                    gap: 8,
                  }}
                >
                  {ZONES.map((z) => {
                    const ms = w[z.key] ?? 0;
                    const pct = totalZoneMs > 0 ? (ms / totalZoneMs) * 100 : 0;
                    return (
                      <div
                        key={z.label}
                        style={{ display: "flex", flexDirection: "column", gap: 2 }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 9,
                            color: "var(--fg-3)",
                            letterSpacing: "0.04em",
                            textTransform: "uppercase",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 1,
                              background: z.color,
                            }}
                          />
                          {z.label}
                        </span>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 11,
                            color: "var(--fg-1)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {formatMinutes(ms)}
                        </span>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 10,
                            color: "var(--fg-3)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--fg-3)",
                }}
              >
                No HR zone data for this workout
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: "var(--fg-3)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--fg-1)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}
