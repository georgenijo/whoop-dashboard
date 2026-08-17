"use client";

import {
  ComposedChart,
  Scatter,
  Line,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import type { BedtimeRecoveryResult } from "@/lib/analytics/bedtime";

type Props = { result: BedtimeRecoveryResult | null };

function formatLongDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

type PointDatum = { date: string; bt_dev_min: number; recovery: number };

// Issue #440 review, second pass, WARN 4: checked whether this tooltip has
// the same "clock time shown under the wrong date" bug BedWakeTimeline and
// BedtimePatternsCard had — it doesn't, so it's left as-is rather than
// plumbing a bedDate through (unlike those two, which now show both dates
// when they differ). `bt_dev_min` is a RELATIVE deviation from mean
// bedtime, not an absolute clock time — there's no implied "this happened
// at HH:MM on this date" the way "bedtime 11:11pm" under a date reads.
// `d.date` is the night's own wake day, which is also `recovery`'s date
// (both are computed from and about the SAME night by construction — see
// computeBedtimeRecoveryCorr's direct s.date lookup, BLOCK 1 of the first
// review pass) — so the header date is the correct, canonical identifier
// for the point as a whole, and "bedtime {dev}m" is honestly a property of
// that same night, not a separately-dated event.
function PointTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: PointDatum }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (d.date == null) return null;
  const sign = d.bt_dev_min >= 0 ? "+" : "";
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
        bedtime {sign}
        {d.bt_dev_min.toFixed(0)}m · recovery {d.recovery}%
      </div>
    </div>
  );
}

export default function BedtimeRecoveryScatter({ result }: Props) {
  if (!result) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
            Bedtime vs next-day recovery
          </div>
        </div>
        <div className="empty-state">
          <div className="title">Need at least 5 nights with bedtime data</div>
          <div className="sub">Backfill or sync to populate</div>
        </div>
      </div>
    );
  }

  const xs = result.points.map((p) => p.bt_dev_min);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const lineData = [
    { bt_dev_min: minX, regression: result.slope * minX + result.intercept },
    { bt_dev_min: maxX, regression: result.slope * maxX + result.intercept },
  ];

  const r = result.correlation;
  const rColor = r >= 0 ? "#00d4aa" : "#ff8866";

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
            Bedtime vs next-day recovery
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            <span style={{ color: rColor }}>r = {r.toFixed(2)}</span>
            <span style={{ color: "var(--fg-3)", marginLeft: 6 }}>
              · {result.points.length} paired nights
            </span>
          </div>
        </div>
      </div>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 8, right: 12, left: 0, bottom: 24 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" />
            <XAxis
              type="number"
              dataKey="bt_dev_min"
              domain={["dataMin - 10", "dataMax + 10"]}
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
              tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}m`}
              label={{
                value: "bedtime deviation",
                position: "insideBottom",
                offset: -8,
                style: { fontFamily: "var(--font-mono)", fontSize: 10, fill: "var(--fg-3)" },
              }}
            />
            <YAxis
              type="number"
              dataKey="recovery"
              domain={[0, 100]}
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              width={32}
              tickFormatter={(v: number) => `${v}%`}
            />
            <ZAxis range={[60, 60]} />
            <ReferenceLine x={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="2 3" />
            <Tooltip content={<PointTooltip />} cursor={{ stroke: "rgba(255,255,255,0.12)" }} />
            <Scatter data={result.points} fill="#7b61ff" />
            <Line
              data={lineData}
              dataKey="regression"
              stroke="#00d4aa"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
              legendType="none"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div
        style={{
          marginTop: 8,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--fg-3)",
        }}
      >
        Negative = earlier than usual · Positive = later than usual
      </div>
    </div>
  );
}
