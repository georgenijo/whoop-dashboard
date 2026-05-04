"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  ReferenceArea,
  Dot,
} from "recharts";
import type { SleepRow } from "@/lib/db";

type Props = { rows: SleepRow[] };

const NORMAL_LOW = 14;
const NORMAL_HIGH = 18;
const SPIKE_THRESHOLD = 1.5;

function formatTickDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatLongDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

type TooltipPayload = { payload: { date: string; rr: number | null } };

function RRTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (d.rr == null) return null;
  const outOfRange = d.rr < NORMAL_LOW || d.rr > NORMAL_HIGH;
  return (
    <div
      style={{
        background: "rgba(12,12,18,0.92)",
        border: `1px solid ${outOfRange ? "#ff4444aa" : "#00d4aa66"}`,
        borderRadius: 8,
        padding: "6px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <div style={{ color: "var(--fg-3)", marginBottom: 2 }}>{formatLongDate(d.date)}</div>
      <div style={{ color: outOfRange ? "#ff4444" : "#00d4aa" }}>{d.rr.toFixed(1)} br/min</div>
    </div>
  );
}

type DotProps = {
  cx?: number;
  cy?: number;
  payload?: { rr: number | null };
};

function PointDot({ cx, cy, payload }: DotProps) {
  if (cx == null || cy == null || !payload || payload.rr == null) return null;
  const outOfRange = payload.rr < NORMAL_LOW || payload.rr > NORMAL_HIGH;
  if (outOfRange) {
    return <Dot cx={cx} cy={cy} r={4} fill="#ff4444" stroke="#ff4444" strokeWidth={1} />;
  }
  return <Dot cx={cx} cy={cy} r={2} fill="#00d4aa" />;
}

export default function RespiratoryRateChart({ rows }: Props) {
  const recent = rows.slice(-14);
  const data = recent.map((r) => ({ date: r.date, rr: r.respiratory_rate }));
  const valid = data.filter((d): d is { date: string; rr: number } => d.rr != null);

  if (valid.length < 2) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
            Respiratory rate
          </div>
        </div>
        <div className="empty-state">
          <div className="title">Not enough data yet</div>
          <div className="sub">Sync Whoop to populate this chart</div>
        </div>
      </div>
    );
  }

  const baseline = valid.reduce((a, b) => a + b.rr, 0) / valid.length;
  let spike: { date: string; rr: number } | null = null;
  for (let i = valid.length - 1; i >= 0; i--) {
    if (valid[i].rr > baseline + SPIKE_THRESHOLD) {
      spike = valid[i];
      break;
    }
  }

  const min = Math.min(NORMAL_LOW - 2, ...valid.map((d) => d.rr));
  const max = Math.max(NORMAL_HIGH + 2, ...valid.map((d) => d.rr));

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
            Respiratory rate
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            14d · normal {NORMAL_LOW}–{NORMAL_HIGH} br/min · baseline {baseline.toFixed(1)}
          </div>
        </div>
      </div>
      <div style={{ height: 180 }}>
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
              domain={[Math.floor(min), Math.ceil(max)]}
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <ReferenceArea y1={NORMAL_LOW} y2={NORMAL_HIGH} fill="#00d4aa" fillOpacity={0.07} />
            <ReferenceLine y={NORMAL_LOW} stroke="#00d4aa" strokeDasharray="4 3" strokeOpacity={0.5} />
            <ReferenceLine y={NORMAL_HIGH} stroke="#00d4aa" strokeDasharray="4 3" strokeOpacity={0.5} />
            <Tooltip content={<RRTooltip />} />
            <Line
              type="monotone"
              dataKey="rr"
              stroke="#00d4aa"
              strokeWidth={2}
              dot={<PointDot />}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {spike && (
        <div
          style={{
            marginTop: 10,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "#ff8888",
          }}
        >
          Spike on {formatLongDate(spike.date)} (+{(spike.rr - baseline).toFixed(1)} above baseline) — possible illness/stress signal
        </div>
      )}
    </div>
  );
}
