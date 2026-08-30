"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Row = { date: string; skin_temp: number | null; recovery_score: number | null };

type Props = {
  data: Row[];
  rangeLabel: string;
};

const ELEVATED_COLOR = "#ffaa00";
const BELOW_COLOR = "#00aaff";
const NORMAL_COLOR = "#00d4aa";
const ELEVATED_THRESHOLD = 0.5;
const RECOVERY_DROP_THRESHOLD = 10;

function colorFor(dev: number): string {
  if (dev > ELEVATED_THRESHOLD) return ELEVATED_COLOR;
  if (dev < 0) return BELOW_COLOR;
  return NORMAL_COLOR;
}

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

type ChartDatum = {
  date: string;
  dev: number;
  skin_temp: number;
  color: string;
};

type Annotation =
  | { kind: "none" }
  | { kind: "run"; days: number; recoveryDrop: number | null };

function detectAnnotation(rows: Row[], mean: number): Annotation {
  // Walk from most recent backwards; find latest run of >=2 consecutive elevated days.
  let runEnd = -1;
  let runStart = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i].skin_temp;
    if (v != null && v - mean > ELEVATED_THRESHOLD) {
      runEnd = i;
      runStart = i;
      while (runStart - 1 >= 0) {
        const prev = rows[runStart - 1].skin_temp;
        if (prev != null && prev - mean > ELEVATED_THRESHOLD) runStart--;
        else break;
      }
      break;
    }
  }
  const days = runEnd - runStart + 1;
  if (runEnd < 0 || days < 2) return { kind: "none" };

  const recoveryValid = rows
    .map((r) => r.recovery_score)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (recoveryValid.length < 3) return { kind: "run", days, recoveryDrop: null };
  const recoveryMean =
    recoveryValid.reduce((a, b) => a + b, 0) / recoveryValid.length;

  const next = rows[runEnd + 1];
  if (next && next.recovery_score != null) {
    const drop = recoveryMean - next.recovery_score;
    if (drop >= RECOVERY_DROP_THRESHOLD) {
      return { kind: "run", days, recoveryDrop: Math.round(drop) };
    }
  }
  return { kind: "run", days, recoveryDrop: null };
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
  return (
    <div
      style={{
        background: "rgba(12,12,18,0.92)",
        border: `1px solid ${p.color}44`,
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
          fontSize: 16,
          color: p.color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {p.dev >= 0 ? "+" : ""}
        {p.dev.toFixed(2)} °C
      </div>
      <div style={{ fontSize: 10, color: "var(--fg-3)", marginTop: 2 }}>
        {p.skin_temp.toFixed(2)} °C absolute
      </div>
    </div>
  );
}

export default function SkinTempDeviationCard({ data, rangeLabel }: Props) {
  const computed = useMemo(() => {
    const valid = data.filter(
      (r): r is { date: string; skin_temp: number; recovery_score: number | null } =>
        r.skin_temp != null && Number.isFinite(r.skin_temp)
    );
    if (valid.length < 7) {
      return null;
    }
    const mean =
      valid.reduce((a, b) => a + b.skin_temp, 0) / valid.length;
    const chartData: ChartDatum[] = valid.map((r) => {
      const dev = r.skin_temp - mean;
      return {
        date: r.date,
        dev,
        skin_temp: r.skin_temp,
        color: colorFor(dev),
      };
    });
    const maxAbs = Math.max(
      0.5,
      ...chartData.map((d) => Math.abs(d.dev))
    );
    const annotation = detectAnnotation(data, mean);
    return { mean, chartData, maxAbs, annotation };
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
                  background: ELEVATED_COLOR,
                  marginRight: 8,
                }}
              />
              Skin temperature deviation
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              {rangeLabel} baseline · °C from mean
            </div>
          </div>
        </div>
        <div className="empty-state">
          <div className="title">Need 7+ days of skin temp</div>
          <div className="sub">Whoop 4.0+ strap required</div>
        </div>
      </div>
    );
  }

  const { mean, chartData, maxAbs, annotation } = computed;
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
                background: ELEVATED_COLOR,
                marginRight: 8,
              }}
            />
            Skin temperature deviation
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            {rangeLabel} baseline · mean {mean.toFixed(2)} °C
          </div>
        </div>
        <span className="card-sub">
          <span style={{ color: BELOW_COLOR }}>below</span>
          {" · "}
          <span style={{ color: NORMAL_COLOR }}>normal</span>
          {" · "}
          <span style={{ color: ELEVATED_COLOR }}>elevated &gt; +0.5°C</span>
        </span>
      </div>

      <div className="chart-body" style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
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
              domain={[-maxAbs, maxAbs]}
              tick={{ fill: "var(--fg-3)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={36}
              tickFormatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`}
            />
            <ReferenceLine
              y={0}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth={1}
            />
            <ReferenceLine
              y={ELEVATED_THRESHOLD}
              stroke={ELEVATED_COLOR}
              strokeDasharray="3 3"
              strokeOpacity={0.45}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Bar dataKey="dev" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {chartData.map((d) => (
                <Cell key={d.date} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {annotation.kind === "run" && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,170,0,0.35)",
            background: "rgba(255,170,0,0.08)",
            color: "var(--fg-1)",
            fontSize: 13,
          }}
        >
          Elevated for {annotation.days} consecutive days — possible illness signal
          {annotation.recoveryDrop != null && (
            <span style={{ color: "var(--fg-3)", marginLeft: 6 }}>
              (recovery dropped {annotation.recoveryDrop}% next day)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
