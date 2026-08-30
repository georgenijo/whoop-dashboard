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
} from "recharts";
import type { NapRow, RecoveryRow } from "@/lib/db";
import { linearRegression } from "@/lib/analytics/bedtime";

type Props = { naps: NapRow[]; recovery: RecoveryRow[]; rangeLabel: string };

const MS_PER_MIN = 60_000;

function formatLongDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function nextDate(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function napDurationMs(n: NapRow): number {
  return (n.light_ms ?? 0) + (n.deep_ms ?? 0) + (n.rem_ms ?? 0);
}

type Point = { date: string; durationMin: number; recovery: number };

function PointTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Point }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (d.date == null) return null;
  return (
    <div
      style={{
        background: "rgba(12,12,18,0.92)",
        border: "1px solid #00d4aa66",
        borderRadius: 8,
        padding: "6px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <div style={{ color: "var(--fg-3)", marginBottom: 2 }}>{formatLongDate(d.date)}</div>
      <div style={{ color: "var(--fg-1)" }}>
        {Math.round(d.durationMin)}m · next-day {d.recovery}%
      </div>
    </div>
  );
}

export default function NapRecoveryScatter({ naps, recovery, rangeLabel }: Props) {
  const recoveryByDate = new Map<string, number>();
  for (const r of recovery) {
    if (r.recovery_score != null) recoveryByDate.set(r.date, r.recovery_score);
  }

  const points: Point[] = [];
  for (const n of naps) {
    const ms = napDurationMs(n);
    if (ms <= 0) continue;
    const rec = recoveryByDate.get(nextDate(n.date));
    if (rec == null) continue;
    points.push({ date: n.date, durationMin: ms / MS_PER_MIN, recovery: rec });
  }

  if (points.length < 3) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
            Nap duration vs next-day recovery
          </div>
        </div>
        <div className="empty-state">
          <div className="title">Need at least 3 nap-recovery pairs</div>
          <div className="sub">Take a few naps, sync, and check back</div>
        </div>
      </div>
    );
  }

  const reg = linearRegression(points.map((p) => ({ x: p.durationMin, y: p.recovery })));
  const xs = points.map((p) => p.durationMin);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const lineData = reg
    ? [
        { durationMin: minX, regression: reg.slope * minX + reg.intercept },
        { durationMin: maxX, regression: reg.slope * maxX + reg.intercept },
      ]
    : [];

  const r = reg?.correlation ?? null;
  const rColor = r == null ? "var(--fg-3)" : r >= 0 ? "#00d4aa" : "#ff8866";

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
            Nap duration vs next-day recovery
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            {r != null && <span style={{ color: rColor }}>r = {r.toFixed(2)}</span>}
            <span style={{ color: "var(--fg-3)", marginLeft: r != null ? 6 : 0 }}>
              · {rangeLabel} · {points.length} pairs
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
              dataKey="durationMin"
              domain={["dataMin - 5", "dataMax + 5"]}
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
              tickFormatter={(v: number) => `${Math.round(v)}m`}
              label={{
                value: "nap duration",
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
            <Tooltip content={<PointTooltip />} cursor={{ stroke: "rgba(255,255,255,0.12)" }} />
            <Scatter data={points} fill="#00d4aa" />
            {reg && (
              <Line
                data={lineData}
                dataKey="regression"
                stroke="#7b61ff"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
                legendType="none"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
