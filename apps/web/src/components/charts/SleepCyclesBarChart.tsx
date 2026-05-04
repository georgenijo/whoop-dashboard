"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from "recharts";
import type { SleepRow } from "@/lib/db";

type Props = { rows: SleepRow[] };

function formatTickDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function colorFor(cycles: number | null): string {
  if (cycles == null) return "#3f3f46";
  if (cycles >= 4) return "#00d4aa";
  if (cycles === 3) return "#ff8800";
  return "#ff4444";
}

type TooltipPayload = { payload: { date: string; cycles: number | null } };

function CyclesTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (d.cycles == null) return null;
  return (
    <div
      style={{
        background: "rgba(12,12,18,0.92)",
        border: `1px solid ${colorFor(d.cycles)}66`,
        borderRadius: 8,
        padding: "6px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <div style={{ color: "var(--fg-3)", marginBottom: 2 }}>
        {new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
      </div>
      <div style={{ color: colorFor(d.cycles) }}>{d.cycles} cycle{d.cycles === 1 ? "" : "s"}</div>
    </div>
  );
}

export default function SleepCyclesBarChart({ rows }: Props) {
  const recent = rows.slice(-14);
  const data = recent.map((r) => ({ date: r.date, cycles: r.cycles }));
  const valid = data.filter((d) => d.cycles != null);

  if (valid.length < 2) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
            Sleep cycles
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
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
            Sleep cycles
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>14d · 4–5 complete 90-min cycles = optimal</div>
        </div>
      </div>
      <div style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatTickDate}
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              domain={[0, "dataMax + 1"]}
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <ReferenceLine y={4} stroke="#00d4aa" strokeDasharray="4 3" strokeOpacity={0.4} />
            <Tooltip content={<CyclesTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <Bar dataKey="cycles" radius={[4, 4, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={colorFor(d.cycles)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
