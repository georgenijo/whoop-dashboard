"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { SleepRow } from "@/lib/db";

type Props = { rows: SleepRow[] };

function formatTickDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type TooltipPayload = { payload: { date: string; consistency: number | null } };

function ConsistencyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div
      style={{
        background: "rgba(12,12,18,0.92)",
        border: "1px solid #00aaff44",
        borderRadius: 8,
        padding: "6px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <div style={{ color: "var(--fg-3)", marginBottom: 2 }}>
        {new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
      </div>
      <div style={{ color: "#00aaff" }}>
        Consistency: {d.consistency != null ? `${d.consistency.toFixed(0)}%` : "—"}
      </div>
    </div>
  );
}

function avg(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

export default function SleepConsistencyCard({ rows }: Props) {
  const recent = rows.slice(-14);
  const data = recent.map((r) => ({ date: r.date, consistency: r.consistency }));
  const avgConsistency = avg(recent.map((r) => r.consistency));
  const avgEfficiency = avg(recent.map((r) => r.efficiency));
  const avgDisturbances = avg(recent.map((r) => r.disturbances));

  if (data.filter((d) => d.consistency != null).length < 2) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "#00aaff", color: "#00aaff" }} />
            Sleep consistency
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
            <span className="dot" style={{ background: "#00aaff", color: "#00aaff" }} />
            Sleep consistency
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>14d trend</div>
        </div>
      </div>
      <div style={{ height: 140 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatTickDate}
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <Tooltip content={<ConsistencyTooltip />} />
            <Line
              type="monotone"
              dataKey="consistency"
              stroke="#00aaff"
              strokeWidth={2}
              dot={{ r: 2, fill: "#00aaff" }}
              activeDot={{ r: 4 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 12 }}>
        <KPI label="Avg consistency" value={avgConsistency != null ? `${avgConsistency.toFixed(0)}%` : "—"} />
        <KPI label="Avg efficiency" value={avgEfficiency != null ? `${avgEfficiency.toFixed(0)}%` : "—"} />
        <KPI label="Avg disturbances" value={avgDisturbances != null ? avgDisturbances.toFixed(1) : "—"} />
      </div>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)" }}>{label}</span>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 18,
          color: "var(--fg-1)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </span>
    </div>
  );
}
