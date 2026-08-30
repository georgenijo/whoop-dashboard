"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReboundEvent } from "@/lib/analytics/rebound";

const ACCENT = "#00d4aa";

function shortDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function fullDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

type ChartRow = {
  red_date: string;
  green_date: string;
  days_to_rebound: number;
  short: string;
};

type TooltipPayload = { payload: ChartRow };

function ReboundTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div
      style={{
        background: "rgba(12,12,18,0.92)",
        border: `1px solid ${ACCENT}66`,
        borderRadius: 8,
        padding: "6px 10px",
        backdropFilter: "blur(8px)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <div style={{ color: "var(--fg-3)", marginBottom: 4 }}>
        {fullDate(p.red_date)} → {fullDate(p.green_date)}
      </div>
      <div style={{ color: ACCENT, fontFamily: "var(--font-display)", fontSize: 16 }}>
        {p.days_to_rebound} {p.days_to_rebound === 1 ? "day" : "days"}
      </div>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)" }}>
        {label}
      </span>
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

export default function RecoveryReboundCard({
  events,
  rangeLabel,
}: {
  events: ReboundEvent[];
  rangeLabel: string;
}) {
  if (events.length === 0) {
    return (
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: ACCENT, color: ACCENT }} />
              Recovery rebound rate
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              {rangeLabel} · days from red (&lt;33) to green (&gt;66)
            </div>
          </div>
        </div>
        <div className="empty-state">
          <div className="title">No rebound events found</div>
          <div className="sub">Extend your data window</div>
        </div>
      </div>
    );
  }

  const days = events.map((e) => e.days_to_rebound);
  const avg = days.reduce((a, b) => a + b, 0) / days.length;
  const fastest = Math.min(...days);

  const data: ChartRow[] = events.map((e) => ({
    red_date: e.red_date,
    green_date: e.green_date,
    days_to_rebound: e.days_to_rebound,
    short: shortDate(e.red_date),
  }));

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: ACCENT, color: ACCENT }} />
            Recovery rebound rate
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            {rangeLabel} · days from red (&lt;33) to green (&gt;66) · lower is better
          </div>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <KPI label="Avg rebound" value={`${avg.toFixed(1)} d`} />
        <KPI label="Fastest" value={`${fastest} d`} />
        <KPI label="Total events" value={`${events.length}`} />
      </div>
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="short"
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
              minTickGap={16}
            />
            <YAxis
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              width={28}
              tickFormatter={(v: number) => `${v}d`}
            />
            <Tooltip
              content={<ReboundTooltip />}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Bar dataKey="days_to_rebound" fill={ACCENT} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
