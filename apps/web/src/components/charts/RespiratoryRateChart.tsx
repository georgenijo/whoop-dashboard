"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Dot,
} from "recharts";
import type { SleepRow } from "@/lib/db";

type Props = { rows: SleepRow[] };

const ANOMALY_THRESHOLD = 2;
const WINDOW = 14;

function formatTickDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatLongDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

type ChartDatum = {
  date: string;
  rr: number | null;
  mean: number | null;
  lower: number | null;
  upper: number | null;
  anomaly: boolean;
};

type TooltipPayload = { payload: ChartDatum };

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
  return (
    <div
      style={{
        background: "rgba(12,12,18,0.92)",
        border: `1px solid ${d.anomaly ? "#ff4444aa" : "#00d4aa66"}`,
        borderRadius: 8,
        padding: "6px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <div style={{ color: "var(--fg-3)", marginBottom: 2 }}>{formatLongDate(d.date)}</div>
      <div style={{ color: d.anomaly ? "#ff4444" : "#00d4aa" }}>{d.rr.toFixed(1)} br/min</div>
      {d.mean != null && (
        <div style={{ color: "var(--fg-3)", fontSize: 10, marginTop: 2 }}>
          baseline {d.mean.toFixed(1)} ±{ANOMALY_THRESHOLD}
        </div>
      )}
    </div>
  );
}

type DotProps = {
  cx?: number;
  cy?: number;
  payload?: ChartDatum;
};

function PointDot({ cx, cy, payload }: DotProps) {
  if (cx == null || cy == null || !payload || payload.rr == null) return null;
  if (payload.anomaly) {
    const s = 5;
    return (
      <polygon
        points={`${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`}
        fill="#ff4444"
        stroke="#ff4444"
        strokeWidth={1}
      />
    );
  }
  return <Dot cx={cx} cy={cy} r={2} fill="#00d4aa" />;
}

export default function RespiratoryRateChart({ rows }: Props) {
  const recent = rows.slice(-14);
  const valid = recent.filter(
    (r): r is SleepRow & { respiratory_rate: number } => r.respiratory_rate != null,
  );

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

  const data: ChartDatum[] = recent.map((r, i) => {
    if (r.respiratory_rate == null) {
      return { date: r.date, rr: null, mean: null, lower: null, upper: null, anomaly: false };
    }
    const start = Math.max(0, i - WINDOW + 1);
    let sum = 0;
    let count = 0;
    for (let j = start; j <= i; j++) {
      const v = recent[j].respiratory_rate;
      if (v != null) {
        sum += v;
        count += 1;
      }
    }
    const mean = count > 0 ? sum / count : null;
    const lower = mean != null ? mean - ANOMALY_THRESHOLD : null;
    const upper = mean != null ? mean + ANOMALY_THRESHOLD : null;
    const anomaly =
      mean != null && Math.abs(r.respiratory_rate - mean) > ANOMALY_THRESHOLD;
    return { date: r.date, rr: r.respiratory_rate, mean, lower, upper, anomaly };
  });

  const overallMean = valid.reduce((a, b) => a + b.respiratory_rate, 0) / valid.length;
  const allValues = data
    .flatMap((d) => [d.rr, d.lower, d.upper])
    .filter((v): v is number => v != null);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const anomalies = data.filter((d) => d.anomaly && d.rr != null).length;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
            Respiratory rate
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            14d · personal baseline ±{ANOMALY_THRESHOLD} br/min · mean {overallMean.toFixed(1)}
            {anomalies > 0 && (
              <span style={{ color: "#ff8888", marginLeft: 6 }}>
                · {anomalies} anomaly{anomalies === 1 ? "" : "s"}
              </span>
            )}
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
              domain={[Math.floor(min - 0.5), Math.ceil(max + 0.5)]}
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <Tooltip content={<RRTooltip />} />
            <Line
              type="monotone"
              dataKey="upper"
              stroke="#00d4aa"
              strokeWidth={1}
              strokeDasharray="3 3"
              strokeOpacity={0.4}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="lower"
              stroke="#00d4aa"
              strokeWidth={1}
              strokeDasharray="3 3"
              strokeOpacity={0.4}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="mean"
              stroke="#00d4aa"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              strokeOpacity={0.7}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="rr"
              stroke="#00d4aa"
              strokeWidth={2}
              dot={<PointDot />}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
