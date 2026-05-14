"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { WorkoutRow } from "@/lib/db";

type Props = { rows: WorkoutRow[]; maxHR?: number | null; rangeLabel?: string };

const ZONES = [
  { key: "zone_0_ms" as const, label: "Z0", color: "#1e3a8a", lowPct: 0,  highPct: 50 },
  { key: "zone_1_ms" as const, label: "Z1", color: "#2563eb", lowPct: 50, highPct: 60 },
  { key: "zone_2_ms" as const, label: "Z2", color: "#06b6d4", lowPct: 60, highPct: 70 },
  { key: "zone_3_ms" as const, label: "Z3", color: "#facc15", lowPct: 70, highPct: 80 },
  { key: "zone_4_ms" as const, label: "Z4", color: "#f97316", lowPct: 80, highPct: 90 },
  { key: "zone_5_ms" as const, label: "Z5", color: "#b91c1c", lowPct: 90, highPct: 100 },
];

const MAX_ROWS = 14;

function formatLabel(date: string, sport: string | null): string {
  const d = new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return `${d} · ${sport ?? "—"}`;
}

function buildLegendLabel(
  zone: typeof ZONES[number],
  maxHR: number | null,
): string {
  if (!maxHR) return zone.label;
  const lowBpm = Math.round((maxHR * zone.lowPct) / 100);
  const highBpm = Math.round((maxHR * zone.highPct) / 100);
  if (zone.lowPct === 0) {
    return `${zone.label} <${zone.highPct}% · <${highBpm} bpm`;
  }
  if (zone.highPct === 100) {
    return `${zone.label} >${zone.lowPct}% · >${lowBpm} bpm`;
  }
  return `${zone.label} ${zone.lowPct}–${zone.highPct}% · ${lowBpm}–${highBpm} bpm`;
}

export default function WorkoutZoneChart({ rows, maxHR, rangeLabel }: Props) {
  const effectiveMax =
    maxHR != null && Number.isFinite(maxHR) && maxHR > 0 ? maxHR : null;

  // Rows arrive ordered date DESC (newest first) from getWorkoutsRange. Take
  // the first MAX_ROWS so the most-recent workout always appears, and keep
  // newest-on-top in the rendered vertical bar list.
  const withZones = rows
    .filter((r) => {
      const total = ZONES.reduce((sum, z) => sum + (r[z.key] ?? 0), 0);
      return total > 0;
    })
    .slice(0, MAX_ROWS);

  if (withZones.length === 0) {
    return (
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: "#06b6d4", color: "#06b6d4" }} />
              HR zone breakdown
            </div>
            {rangeLabel ? (
              <div className="card-sub" style={{ marginTop: 4 }}>{rangeLabel}</div>
            ) : null}
          </div>
        </div>
        <div className="empty-state">
          <div className="title">No zone data in range</div>
          <div className="sub">Extend the date range or sync Whoop</div>
        </div>
      </div>
    );
  }

  const chartData = withZones.map((r) => {
    const obj: Record<string, number | string> = {
      label: formatLabel(r.date, r.sport),
    };
    for (const z of ZONES) {
      obj[z.label] = (r[z.key] ?? 0) / 60_000;
    }
    return obj;
  });

  const totalsByZone = ZONES.map((z) => ({
    label: z.label,
    color: z.color,
    minutes: withZones.reduce((sum, r) => sum + (r[z.key] ?? 0), 0) / 60_000,
  }));
  const grandTotal = totalsByZone.reduce((sum, t) => sum + t.minutes, 0) || 1;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#06b6d4", color: "#06b6d4" }} />
            HR zone breakdown
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            {[
              rangeLabel,
              `${withZones.length} sessions · minutes per zone`,
              effectiveMax ? `max HR ${effectiveMax} bpm` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {ZONES.map((z) => (
            <span
              key={z.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--fg-3)",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 2, background: z.color, display: "inline-block" }} />
              {buildLegendLabel(z, effectiveMax)}
            </span>
          ))}
        </div>
      </div>

      <div style={{ width: "100%", height: Math.max(220, withZones.length * 28) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={chartData}
            margin={{ top: 4, right: 16, bottom: 16, left: 8 }}
          >
            <XAxis
              type="number"
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
              tickLine={false}
              label={{ value: "minutes", position: "insideBottom", offset: -4, fill: "var(--fg-3)", fontSize: 10 }}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fill: "var(--fg-2)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
              tickLine={false}
              width={130}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              contentStyle={{
                background: "rgba(12,12,18,0.92)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
              formatter={(v) => `${Number(v).toFixed(1)} min`}
            />
            {ZONES.map((z) => (
              <Bar key={z.label} dataKey={z.label} stackId="zones" fill={z.color}>
                {chartData.map((_, i) => (
                  <Cell key={i} />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gap: 8,
        }}
      >
        {totalsByZone.map((t) => (
          <div key={t.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                color: "var(--fg-3)",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              {t.label} avg
            </span>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 16,
                fontWeight: 500,
                color: t.color,
                letterSpacing: "-0.02em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {((t.minutes / grandTotal) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
