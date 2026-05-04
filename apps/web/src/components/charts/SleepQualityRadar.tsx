"use client";

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";
import type { SleepRow } from "@/lib/db";

type Props = { latest: SleepRow | null; window: SleepRow[] };

const REM_TARGET = 30;
const DEEP_TARGET = 25;
const DISTURBANCE_PENALTY = 4;

type Metrics = {
  Efficiency: number;
  Consistency: number;
  Performance: number;
  REM: number;
  Deep: number;
  "Low Disturbance": number;
};

function clamp01to100(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function rowMetrics(row: SleepRow): Metrics | null {
  const asleep = (row.light_ms ?? 0) + (row.deep_ms ?? 0) + (row.rem_ms ?? 0);
  if (asleep === 0) return null;
  const remPct = ((row.rem_ms ?? 0) / asleep) * 100;
  const deepPct = ((row.deep_ms ?? 0) / asleep) * 100;
  return {
    Efficiency: clamp01to100(row.efficiency ?? 0),
    Consistency: clamp01to100(row.consistency ?? 0),
    Performance: clamp01to100(row.performance ?? 0),
    REM: clamp01to100((remPct / REM_TARGET) * 100),
    Deep: clamp01to100((deepPct / DEEP_TARGET) * 100),
    "Low Disturbance": clamp01to100(100 - (row.disturbances ?? 0) * DISTURBANCE_PENALTY),
  };
}

function avgMetrics(rows: SleepRow[]): Metrics | null {
  const all = rows.map(rowMetrics).filter((m): m is Metrics => m !== null);
  if (all.length === 0) return null;
  const keys = Object.keys(all[0]) as (keyof Metrics)[];
  const out = {} as Metrics;
  for (const k of keys) {
    out[k] = all.reduce((sum, m) => sum + m[k], 0) / all.length;
  }
  return out;
}

const AXES: (keyof Metrics)[] = [
  "Efficiency",
  "Consistency",
  "Performance",
  "REM",
  "Deep",
  "Low Disturbance",
];

export default function SleepQualityRadar({ latest, window }: Props) {
  const latestM = latest ? rowMetrics(latest) : null;
  const avgM = avgMetrics(window);

  if (!latestM && !avgM) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
            Sleep quality
          </div>
        </div>
        <div className="empty-state">
          <div className="title">No data yet</div>
          <div className="sub">Sync Whoop to see quality breakdown</div>
        </div>
      </div>
    );
  }

  const data = AXES.map((axis) => ({
    axis,
    "Last night": latestM ? Number(latestM[axis].toFixed(1)) : 0,
    "30d avg": avgM ? Number(avgM[axis].toFixed(1)) : 0,
  }));

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
            Sleep quality
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            6 dimensions · last night vs 30d avg
          </div>
        </div>
      </div>
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="78%">
            <PolarGrid stroke="rgba(255,255,255,0.08)" />
            <PolarAngleAxis
              dataKey="axis"
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={false}
              axisLine={false}
            />
            <Radar
              name="30d avg"
              dataKey="30d avg"
              stroke="#ff8800"
              fill="#ff8800"
              fillOpacity={0.12}
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <Radar
              name="Last night"
              dataKey="Last night"
              stroke="#00d4aa"
              fill="#00d4aa"
              fillOpacity={0.35}
              strokeWidth={1.8}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(12,12,18,0.92)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
            />
            <Legend
              wrapperStyle={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)" }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
