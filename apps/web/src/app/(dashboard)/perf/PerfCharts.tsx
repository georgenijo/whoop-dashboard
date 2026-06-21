"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type PerfChartSeries = {
  metric: string;
  unit: "ms" | "";
  color: string;
  goodThreshold: number;
  points: { day: string; p75: number }[];
};

function fmt(unit: "ms" | "", v: number): string {
  if (unit === "") return v.toFixed(3);
  return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;
}

function ChartTooltip({
  active,
  payload,
  label,
  unit,
  color,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  unit: "ms" | "";
  color: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        background: "rgba(12,12,18,0.92)",
        border: `1px solid ${color}44`,
        borderRadius: 8,
        padding: "6px 10px",
        backdropFilter: "blur(8px)",
        whiteSpace: "nowrap",
      }}
    >
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)", marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color }}>
        p75 {fmt(unit, payload[0].value)}
      </div>
    </div>
  );
}

export default function PerfCharts({ charts }: { charts: PerfChartSeries[] }) {
  if (charts.length === 0) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 14,
      }}
    >
      {charts.map((c) => (
        <div key={c.metric} className="card">
          <div className="card-head">
            <div className="card-title">{c.metric}</div>
            <div className="card-sub">daily p75</div>
          </div>
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={c.points} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: "var(--fg-3)" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={20}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--fg-3)" }}
                  tickLine={false}
                  axisLine={false}
                  width={42}
                />
                <ReferenceLine
                  y={c.goodThreshold}
                  stroke="#00d4aa"
                  strokeDasharray="3 3"
                  strokeOpacity={0.5}
                />
                <Tooltip
                  content={<ChartTooltip unit={c.unit} color={c.color} />}
                  cursor={{ stroke: c.color, strokeOpacity: 0.3 }}
                />
                <Line
                  type="monotone"
                  dataKey="p75"
                  stroke={c.color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}
    </div>
  );
}
