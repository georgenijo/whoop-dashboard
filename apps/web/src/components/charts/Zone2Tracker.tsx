"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { WorkoutRow } from "@/lib/db";

type Props = { rows: WorkoutRow[] };

const TARGET_MIN = 30;
const HIT_COLOR = "#10b981";
const MISS_COLOR = "#374151";

function formatShortDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function daysAgo(today: Date, n: number): Date {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return d;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function Zone2Tracker({ rows }: Props) {
  const today = new Date();
  const start30 = toIsoDate(daysAgo(today, 30));
  const start60 = toIsoDate(daysAgo(today, 60));

  const last30 = rows.filter((r) => r.date >= start30);
  const prev30 = rows.filter((r) => r.date >= start60 && r.date < start30);

  const chartData = last30
    .map((r) => ({
      date: r.date,
      sport: r.sport ?? "—",
      z2_min: (r.zone_2_ms ?? 0) / 60_000,
      total_min: (r.duration_sec ?? 0) / 60,
    }))
    .filter((r) => r.z2_min > 0);

  const z2Avg = (sessions: WorkoutRow[]): number => {
    const withZ2 = sessions.filter((r) => (r.zone_2_ms ?? 0) > 0);
    if (withZ2.length === 0) return 0;
    return (
      withZ2.reduce((sum, r) => sum + (r.zone_2_ms ?? 0) / 60_000, 0) / withZ2.length
    );
  };

  const avgThis = z2Avg(last30);
  const avgPrev = z2Avg(prev30);
  const pctChange = avgPrev > 0 ? ((avgThis - avgPrev) / avgPrev) * 100 : null;
  const changeColor = pctChange == null ? "var(--fg-2)" : pctChange >= 0 ? HIT_COLOR : "#ff6b6b";

  if (chartData.length === 0) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: HIT_COLOR, color: HIT_COLOR }} />
            Zone 2 aerobic focus
          </div>
        </div>
        <div className="empty-state">
          <div className="title">No Zone 2 data yet</div>
          <div className="sub">Sync workouts to track aerobic time</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: HIT_COLOR, color: HIT_COLOR }} />
            Zone 2 aerobic focus
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            last 30 days · target {TARGET_MIN} min/session
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Kpi label="This month avg" value={`${avgThis.toFixed(0)} min`} sub="per Z2 session" />
        <Kpi label="Prior month avg" value={`${avgPrev.toFixed(0)} min`} sub="per Z2 session" />
        <Kpi
          label="Change"
          value={pctChange == null ? "—" : `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(0)}%`}
          sub="vs prior month"
          valueColor={changeColor}
        />
      </div>

      <div className="chart-body">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 16, left: 8 }}>
            <XAxis
              dataKey="date"
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
              tickLine={false}
              tickFormatter={(d: string) => formatShortDate(d)}
            />
            <YAxis
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
              tickLine={false}
              label={{
                value: "Z2 min",
                angle: -90,
                position: "insideLeft",
                fill: "var(--fg-3)",
                fontSize: 10,
                style: { textAnchor: "middle" },
              }}
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
              labelFormatter={(d, payload) => {
                const sport = payload && payload[0] ? (payload[0].payload as { sport: string }).sport : "";
                return `${formatShortDate(String(d))} · ${sport}`;
              }}
              formatter={(v, _name, ctx) => {
                const total = (ctx.payload as { total_min: number }).total_min;
                return [`${Number(v).toFixed(0)} min Z2 of ${total.toFixed(0)} min`, "Z2"];
              }}
            />
            <ReferenceLine
              y={TARGET_MIN}
              stroke="rgba(255,255,255,0.45)"
              strokeDasharray="3 3"
              label={{
                value: `${TARGET_MIN} min target`,
                position: "right",
                fill: "var(--fg-3)",
                fontSize: 10,
              }}
            />
            <Bar dataKey="z2_min" radius={[3, 3, 0, 0]}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.z2_min >= TARGET_MIN ? HIT_COLOR : MISS_COLOR} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "10px 12px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 10,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--fg-3)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          fontWeight: 500,
          color: valueColor ?? "var(--fg-1)",
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {value}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)" }}>{sub}</span>
    </div>
  );
}
