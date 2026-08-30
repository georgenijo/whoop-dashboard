"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { DeepSleepEffRow } from "@/lib/analytics/deepSleep";

type Props = { rows: DeepSleepEffRow[]; rangeLabel: string };

function formatTickDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatLongDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

type ChartDatum = DeepSleepEffRow & { rolling7: number | null };

function EffTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChartDatum }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div
      style={{
        background: "rgba(12,12,18,0.92)",
        border: "1px solid #7b61ff66",
        borderRadius: 8,
        padding: "6px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <div style={{ color: "var(--fg-3)", marginBottom: 2 }}>{formatLongDate(d.date)}</div>
      <div style={{ color: "var(--fg-1)" }}>
        ratio {d.ratio.toFixed(3)}
      </div>
      <div style={{ color: "var(--fg-3)", fontSize: 10, marginTop: 2 }}>
        {d.deep_hrs.toFixed(2)}h deep · {d.prior_strain.toFixed(1)} prior strain
      </div>
    </div>
  );
}

function rollingMean(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    let sum = 0;
    let count = 0;
    for (let j = start; j <= i; j++) {
      sum += values[j];
      count += 1;
    }
    out.push(count > 0 ? sum / count : null);
  }
  return out;
}

export default function DeepSleepEfficiencyCard({ rows, rangeLabel }: Props) {
  if (rows.length < 7) {
    return (
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
              Deep sleep efficiency
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>deep hours per unit strain</div>
          </div>
        </div>
        <div className="empty-state">
          <div className="title">Need at least 7 paired nights</div>
          <div className="sub">Each row needs prior-day strain</div>
        </div>
      </div>
    );
  }

  const ratios = rows.map((r) => r.ratio);
  const rolling = rollingMean(ratios, 7);
  const data: ChartDatum[] = rows.map((r, i) => ({ ...r, rolling7: rolling[i] }));
  const overallMean = ratios.reduce((a, b) => a + b, 0) / ratios.length;

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
            Deep sleep efficiency
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            {rangeLabel} · deep hrs / prior-day strain · mean {overallMean.toFixed(3)}
          </div>
        </div>
      </div>
      <div className="chart-body">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="deep-eff-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7b61ff" stopOpacity={0.85} />
                <stop offset="100%" stopColor="#7b61ff" stopOpacity={0.45} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatTickDate}
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
              minTickGap={20}
            />
            <YAxis
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              width={40}
              tickFormatter={(v: number) => v.toFixed(2)}
            />
            <Tooltip content={<EffTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <Bar dataKey="ratio" fill="url(#deep-eff-grad)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
            <Line
              dataKey="rolling7"
              stroke="#00d4aa"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
