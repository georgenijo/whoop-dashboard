"use client";

import { useMemo, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { WorkoutRow } from "@/lib/db";
import { sportColor } from "@/lib/sport-color";

type Props = { rows: WorkoutRow[]; rangeLabel?: string };

type Metric = "count" | "kj" | "duration";

const METRICS: { key: Metric; label: string }[] = [
  { key: "count", label: "Sessions" },
  { key: "kj", label: "kJ" },
  { key: "duration", label: "Duration" },
];

function metricValue(r: WorkoutRow, metric: Metric): number {
  switch (metric) {
    case "count":
      return 1;
    case "kj":
      return r.kilojoule ?? 0;
    case "duration":
      return (r.duration_sec ?? 0) / 60;
  }
}

function formatValue(v: number, metric: Metric): string {
  switch (metric) {
    case "count":
      return `${v.toFixed(0)} sessions`;
    case "kj":
      return `${v.toFixed(0)} kJ`;
    case "duration":
      return v >= 60 ? `${(v / 60).toFixed(1)} h` : `${v.toFixed(0)} min`;
  }
}

export default function SportFrequencyChart({ rows, rangeLabel }: Props) {
  const [metric, setMetric] = useState<Metric>("count");

  const slices = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of rows) {
      const sport = r.sport ?? "Unknown";
      totals.set(sport, (totals.get(sport) ?? 0) + metricValue(r, metric));
    }
    const entries = Array.from(totals.entries())
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    if (entries.length <= 5) {
      return entries.map(([name, value]) => ({ name, value, color: sportColor(name) }));
    }
    const top = entries.slice(0, 5);
    const otherValue = entries.slice(5).reduce((sum, [, v]) => sum + v, 0);
    return [
      ...top.map(([name, value]) => ({ name, value, color: sportColor(name) })),
      { name: "Other", value: otherValue, color: "#3f3f46" },
    ];
  }, [rows, metric]);

  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const sub = rangeLabel ? `${rangeLabel} · top 5 + other` : "top 5 + other";

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#ffaa00", color: "#ffaa00" }} />
            Sport frequency
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>{sub}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Toggle
            options={METRICS.map((m) => ({ key: m.key, label: m.label }))}
            value={metric}
            onChange={(v) => setMetric(v as Metric)}
          />
        </div>
      </div>

      {slices.length === 0 ? (
        <div className="empty-state">
          <div className="title">No workouts in range</div>
          <div className="sub">Sync Whoop or extend the date range</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) 1fr", gap: 16, alignItems: "center" }}>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                  stroke="rgba(0,0,0,0.4)"
                  strokeWidth={1}
                >
                  {slices.map((s) => (
                    <Cell key={s.name} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "rgba(12,12,18,0.92)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                  }}
                  formatter={(v) => formatValue(Number(v), metric)}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {slices.map((s) => {
              const pct = total > 0 ? (s.value / total) * 100 : 0;
              return (
                <div
                  key={s.name}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "10px 1fr auto auto",
                    gap: 8,
                    alignItems: "center",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                  }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} />
                  <span style={{ color: "var(--fg-1)" }}>{s.name}</span>
                  <span style={{ color: "var(--fg-2)", fontVariantNumeric: "tabular-nums" }}>
                    {formatValue(s.value, metric)}
                  </span>
                  <span style={{ color: "var(--fg-3)", fontVariantNumeric: "tabular-nums", width: 36, textAlign: "right" }}>
                    {pct.toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 8,
        padding: 2,
      }}
    >
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              padding: "4px 10px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              background: active ? "rgba(255,255,255,0.08)" : "transparent",
              color: active ? "var(--fg-0)" : "var(--fg-3)",
              letterSpacing: "0.02em",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
