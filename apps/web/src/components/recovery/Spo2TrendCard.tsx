"use client";

import { useMemo } from "react";
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

type Row = { date: string; spo2: number | null };

type Props = {
  data: Row[];
};

const COLOR = "#00aaff";
const FLOOR_COLOR = "#ff3b3b";
const FLOOR = 95;

function shortDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function fullDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

type ChartDatum = { date: string; spo2: number };

function CustomDot(props: {
  cx?: number;
  cy?: number;
  payload?: ChartDatum;
  index?: number;
}) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return null;
  const below = payload.spo2 < FLOOR;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={below ? 4 : 2}
      fill={below ? FLOOR_COLOR : COLOR}
      stroke={below ? "rgba(5,5,10,0.9)" : "none"}
      strokeWidth={below ? 1 : 0}
      style={below ? { filter: `drop-shadow(0 0 4px ${FLOOR_COLOR})` } : undefined}
    />
  );
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartDatum }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  const below = p.spo2 < FLOOR;
  const color = below ? FLOOR_COLOR : COLOR;
  return (
    <div
      style={{
        background: "rgba(12,12,18,0.92)",
        border: `1px solid ${color}44`,
        borderRadius: 8,
        padding: "6px 10px",
        backdropFilter: "blur(8px)",
        boxShadow: `0 4px 16px rgba(0,0,0,0.5)`,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--fg-3)",
          marginBottom: 4,
        }}
      >
        {fullDate(p.date)}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 18,
          color,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.02em",
        }}
      >
        {p.spo2.toFixed(1)}
        <span style={{ fontSize: 11, color: "var(--fg-3)", marginLeft: 2 }}>%</span>
      </div>
      {below && (
        <div style={{ fontSize: 10, color: FLOOR_COLOR, marginTop: 2 }}>
          below 95% floor
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        flex: 1,
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 8,
        padding: "10px 12px",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div className="card-sub" style={{ marginBottom: 4 }}>{label}</div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 18,
          color: color ?? "var(--fg-1)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export default function Spo2TrendCard({ data }: Props) {
  const computed = useMemo(() => {
    const valid = data
      .filter((r): r is { date: string; spo2: number } =>
        r.spo2 != null && Number.isFinite(r.spo2)
      )
      .map<ChartDatum>((r) => ({ date: r.date, spo2: r.spo2 }));
    if (valid.length < 2) return null;
    const values = valid.map((d) => d.spo2);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const lowest = Math.min(...values);
    const best = Math.max(...values);
    const yMin = Math.min(94, Math.floor(lowest));
    const yMax = Math.max(100, Math.ceil(best));
    return { chartData: valid, avg, lowest, best, yMin, yMax };
  }, [data]);

  if (!computed) {
    return (
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: COLOR,
                  marginRight: 8,
                }}
              />
              SpO2
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              30-day · 95% floor
            </div>
          </div>
        </div>
        <div className="empty-state">
          <div className="title">Not enough data yet</div>
          <div className="sub">Sync Whoop to populate this chart</div>
        </div>
      </div>
    );
  }

  const { chartData, avg, lowest, best, yMin, yMax } = computed;
  const lowestBelow = lowest < FLOOR;
  const tickIdx = new Set([
    0,
    Math.floor(chartData.length / 4),
    Math.floor(chartData.length / 2),
    Math.floor((chartData.length * 3) / 4),
    chartData.length - 1,
  ]);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 2,
                background: COLOR,
                marginRight: 8,
              }}
            />
            SpO2
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            30-day · 95% floor reference
          </div>
        </div>
        <span className="card-sub">
          Latest&nbsp;
          <span style={{ color: COLOR }}>
            {chartData[chartData.length - 1].spo2.toFixed(1)}%
          </span>
        </span>
      </div>

      <div className="chart-body" style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 6, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              tick={{ fill: "var(--fg-3)", fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              interval={0}
              ticks={chartData
                .filter((_, i) => tickIdx.has(i))
                .map((d) => d.date)}
            />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fill: "var(--fg-3)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={36}
              tickFormatter={(v: number) => `${v}%`}
            />
            <ReferenceLine
              y={FLOOR}
              stroke={FLOOR_COLOR}
              strokeDasharray="4 3"
              strokeOpacity={0.7}
              label={{
                value: "95% floor",
                position: "insideTopLeft",
                fill: FLOOR_COLOR,
                fontSize: 10,
                opacity: 0.8,
              }}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ stroke: "rgba(255,255,255,0.12)", strokeWidth: 1 }}
            />
            <Line
              type="monotone"
              dataKey="spo2"
              stroke={COLOR}
              strokeWidth={2}
              isAnimationActive={false}
              dot={<CustomDot />}
              activeDot={{ r: 5, fill: COLOR }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <Kpi label="30d avg" value={`${avg.toFixed(1)}%`} />
        <Kpi
          label="Lowest"
          value={`${lowest.toFixed(1)}%`}
          color={lowestBelow ? FLOOR_COLOR : undefined}
        />
        <Kpi label="Best" value={`${best.toFixed(1)}%`} />
      </div>
    </div>
  );
}
