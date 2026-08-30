"use client";

import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SleepRow } from "@/lib/db";

const MS_PER_HOUR = 1000 * 60 * 60;
const COLOR_DEBT = "#ff3b3b";
const COLOR_OK = "#00d4aa";

type ChartRow = {
  date: string;
  shortDate: string;
  fullDate: string;
  cumulative: number;
  nightly: number;
};

function buildSeries(rows: SleepRow[]): ChartRow[] {
  let running = 0;
  return rows.map((r) => {
    const actual = (r.light_ms ?? 0) + (r.deep_ms ?? 0) + (r.rem_ms ?? 0);
    const need = r.sleep_need_ms ?? 0;
    const nightlyMs = need > 0 ? Math.max(0, need - actual) : 0;
    running += nightlyMs;
    const d = new Date(r.date + "T00:00:00");
    return {
      date: r.date,
      shortDate: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      fullDate: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      cumulative: Number((running / MS_PER_HOUR).toFixed(2)),
      nightly: Number((nightlyMs / MS_PER_HOUR).toFixed(2)),
    };
  });
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const color = row.cumulative > 0 ? COLOR_DEBT : COLOR_OK;
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
        {row.fullDate}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--fg-3)" }}>cumulative</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 500, color, fontVariantNumeric: "tabular-nums" }}>
          {row.cumulative.toFixed(1)}
          <span style={{ fontSize: 10, color: "var(--fg-3)", marginLeft: 2 }}>h</span>
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--fg-3)" }}>tonight</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 13, color: "var(--fg-2)", fontVariantNumeric: "tabular-nums" }}>
          {row.nightly > 0 ? `+${row.nightly.toFixed(1)}h` : "0h"}
        </span>
      </div>
    </div>
  );
}

export default function SleepDebtChart({
  rows,
  rangeLabel,
}: {
  rows: SleepRow[];
  rangeLabel: string;
}) {
  const data = buildSeries(rows);
  const todayCumulative = data.length > 0 ? data[data.length - 1].cumulative : 0;
  const accentColor = todayCumulative > 0 ? COLOR_DEBT : COLOR_OK;

  if (data.length < 2) {
    return (
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: accentColor, color: accentColor }} />
              Cumulative sleep debt
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>{rangeLabel} running total</div>
          </div>
        </div>
        <div className="empty-state">
          <div className="title">Not enough sleep data yet</div>
          <div className="sub">Need at least 2 nights to plot a trend</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: accentColor, color: accentColor }} />
            Cumulative sleep debt
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            {rangeLabel} running total · debt = max(0, need − actual)
          </div>
        </div>
        <span className="card-sub">
          Today&nbsp;
          <span style={{ color: accentColor }}>
            {todayCumulative > 0 ? `${todayCumulative.toFixed(1)}h debt` : "no debt"}
          </span>
        </span>
      </div>
      <div className="chart-body">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="sleep-debt-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLOR_DEBT} stopOpacity={0.45} />
                <stop offset="100%" stopColor={COLOR_DEBT} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="shortDate"
              stroke="var(--fg-3)"
              tickLine={false}
              axisLine={false}
              tick={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
              minTickGap={20}
            />
            <YAxis
              stroke="var(--fg-3)"
              tickLine={false}
              axisLine={false}
              tick={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
              width={32}
              tickFormatter={(v: number) => `${v}h`}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: "rgba(255,255,255,0.12)", strokeWidth: 1 }} />
            <ReferenceLine y={0} stroke={COLOR_OK} strokeOpacity={0.4} strokeDasharray="2 2" />
            <Area
              type="monotone"
              dataKey="cumulative"
              stroke={COLOR_DEBT}
              strokeWidth={2}
              fill="url(#sleep-debt-area)"
              activeDot={{ r: 4, fill: COLOR_DEBT, stroke: "rgba(5,5,10,0.9)", strokeWidth: 1.5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
