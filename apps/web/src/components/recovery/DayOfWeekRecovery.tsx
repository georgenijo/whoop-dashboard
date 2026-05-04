"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DayOfWeekRecoveryRow } from "@/lib/db";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function colorFor(avg: number): string {
  if (avg >= 67) return "#00d4aa";
  if (avg <= 34) return "#ff3b3b";
  return "#00aaff";
}

type ChartRow = {
  day: string;
  fullDay: string;
  avg: number;
  count: number;
};

function buildSeries(rows: DayOfWeekRecoveryRow[]): ChartRow[] {
  const byDow = new Map(rows.map((r) => [r.dow, r] as const));
  const series: ChartRow[] = [];
  for (let i = 0; i < 7; i++) {
    const sqliteDow = (i + 1) % 7;
    const row = byDow.get(sqliteDow);
    series.push({
      day: DAY_LABELS[i],
      fullDay: DAY_FULL[i],
      avg: row ? Number(row.avg.toFixed(1)) : 0,
      count: row?.count ?? 0,
    });
  }
  return series;
}

type TooltipRow = ChartRow & { fill?: string };

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: TooltipRow }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  if (row.count === 0) return null;
  const color = colorFor(row.avg);
  return (
    <div
      style={{
        background: "rgba(12,12,18,0.92)",
        border: `1px solid ${color}44`,
        borderRadius: 8,
        padding: "6px 10px",
        backdropFilter: "blur(8px)",
        boxShadow: `0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px ${color}22`,
        whiteSpace: "nowrap",
      }}
    >
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)", marginBottom: 2 }}>
        {row.fullDay} · {row.count} {row.count === 1 ? "day" : "days"}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 18,
          fontWeight: 500,
          color,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {row.avg.toFixed(1)}
        <span style={{ fontSize: 11, color: "var(--fg-3)", marginLeft: 2 }}>%</span>
      </div>
    </div>
  );
}

export default function DayOfWeekRecovery({ rows }: { rows: DayOfWeekRecoveryRow[] }) {
  const data = buildSeries(rows);
  const totalDays = data.reduce((acc, d) => acc + d.count, 0);

  if (totalDays === 0) {
    return (
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
              Recovery by day of week
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>90-day average</div>
          </div>
        </div>
        <div className="empty-state">
          <div className="title">Not enough data yet</div>
          <div className="sub">Sync Whoop to populate this chart</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
            Recovery by day of week
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            90-day average · {totalDays} {totalDays === 1 ? "day" : "days"} of history
          </div>
        </div>
      </div>
      <div className="chart-body">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="day"
              stroke="var(--fg-3)"
              tickLine={false}
              axisLine={false}
              tick={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 34, 67, 100]}
              stroke="var(--fg-3)"
              tickLine={false}
              axisLine={false}
              tick={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
              width={28}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <Bar dataKey="avg" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={colorFor(d.avg)}
                  fillOpacity={d.count === 0 ? 0.15 : 0.85}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
