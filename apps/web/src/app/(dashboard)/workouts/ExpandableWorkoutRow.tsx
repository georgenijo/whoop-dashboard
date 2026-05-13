"use client";

import { useId, useState } from "react";
import type { WorkoutRow } from "@/lib/db/workouts";

type Props = {
  workout: WorkoutRow;
  formattedDate: string;
  formattedDuration: string;
  kilojoule: number | null;
};

function ZoneBar({ label, ms, totalMs }: { label: string; ms: number | null; totalMs: number }) {
  const pct = ms != null && totalMs > 0 ? (ms / totalMs) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
      <span style={{ color: "var(--fg-3)", width: 40, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
        <div style={{ width: `${pct.toFixed(1)}%`, height: "100%", background: "#ffaa00", borderRadius: 2 }} />
      </div>
      <span style={{ color: "var(--fg-2)", width: 36, textAlign: "right", flexShrink: 0 }}>
        {ms != null ? `${Math.round(ms / 60000)}m` : "—"}
      </span>
    </div>
  );
}

export default function ExpandableWorkoutRow({ workout: w, formattedDate, formattedDuration, kilojoule }: Props) {
  const [open, setOpen] = useState(false);
  const detailId = useId();

  const kcalFormatted = kilojoule != null ? `${(kilojoule * 0.239).toFixed(0)}` : "—";

  const totalZoneMs =
    (w.zone_0_ms ?? 0) +
    (w.zone_1_ms ?? 0) +
    (w.zone_2_ms ?? 0) +
    (w.zone_3_ms ?? 0) +
    (w.zone_4_ms ?? 0) +
    (w.zone_5_ms ?? 0);

  const hasZones = totalZoneMs > 0;
  const hasDistance = w.distance_m != null;
  const hasDetail = hasZones || hasDistance;

  const interactive = hasDetail
    ? {
        onClick: () => setOpen((v) => !v),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        },
        tabIndex: 0 as const,
        "aria-expanded": open,
        "aria-controls": detailId,
      }
    : {};

  return (
    <>
      <tr
        style={{
          borderBottom: open ? "none" : "1px solid rgba(255,255,255,0.03)",
          cursor: hasDetail ? "pointer" : "default",
        }}
        {...interactive}
      >
        <td style={{ padding: "8px 10px", color: "var(--fg-2)" }}>{formattedDate}</td>
        <td style={{ padding: "8px 10px", color: "var(--fg-0)", fontWeight: 500, fontFamily: "var(--font-sans)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {hasDetail && (
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                style={{
                  width: 12,
                  height: 12,
                  flex: "0 0 auto",
                  color: "var(--fg-3)",
                  transform: open ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform var(--dur-base)",
                }}
              >
                <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
              </svg>
            )}
            {w.sport ?? "—"}
          </span>
        </td>
        <td style={{ padding: "8px 10px", color: "var(--fg-1)" }}>{formattedDuration}</td>
        <td style={{ padding: "8px 10px", color: "#ffaa00", fontWeight: 600 }}>{w.strain?.toFixed(1) ?? "—"}</td>
        <td style={{ padding: "8px 10px", color: "var(--fg-1)" }}>{w.avg_hr != null ? `${w.avg_hr} bpm` : "—"}</td>
        <td style={{ padding: "8px 10px", color: "var(--fg-1)" }}>{w.max_hr != null ? `${w.max_hr} bpm` : "—"}</td>
        <td style={{ padding: "8px 10px", color: "var(--fg-2)" }}>{kcalFormatted}</td>
      </tr>
      <tr
        id={detailId}
        style={{ display: open ? "table-row" : "none", borderBottom: "1px solid rgba(255,255,255,0.03)" }}
      >
        <td colSpan={7} style={{ padding: "0 10px 14px 10px" }}>
          {hasDetail ? (
            <div style={{ display: "grid", gridTemplateColumns: hasZones && hasDistance ? "1fr 1fr" : "1fr", gap: 16, paddingTop: 10 }}>
              {hasDistance && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--fg-3)", marginBottom: 4 }}>Details</div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ color: "var(--fg-3)" }}>Distance</span>
                    <span style={{ color: "var(--fg-1)" }}>{(w.distance_m! / 1000).toFixed(2)} km</span>
                  </div>
                </div>
              )}
              {hasZones && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--fg-3)", marginBottom: 4 }}>HR Zones</div>
                  <ZoneBar label="Zone 0" ms={w.zone_0_ms} totalMs={totalZoneMs} />
                  <ZoneBar label="Zone 1" ms={w.zone_1_ms} totalMs={totalZoneMs} />
                  <ZoneBar label="Zone 2" ms={w.zone_2_ms} totalMs={totalZoneMs} />
                  <ZoneBar label="Zone 3" ms={w.zone_3_ms} totalMs={totalZoneMs} />
                  <ZoneBar label="Zone 4" ms={w.zone_4_ms} totalMs={totalZoneMs} />
                  <ZoneBar label="Zone 5" ms={w.zone_5_ms} totalMs={totalZoneMs} />
                </div>
              )}
            </div>
          ) : null}
        </td>
      </tr>
    </>
  );
}
