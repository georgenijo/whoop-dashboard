"use client";

import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

export type ScatterRow = {
  date: string;
  strain: number | null;
  recovery: number | null;
  sleep_hours: number | null;
};

type ChartPoint = {
  date: string;
  strain: number;
  recovery: number;
  sleep_hours: number | null;
};

const RED = "#ff3b3b";
const YELLOW = "#ffaa00";
const GREEN = "#00d4aa";

function formatLongDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function colorFor(p: ChartPoint): string {
  if (p.recovery > 66) return GREEN;
  if (p.recovery < 33 && p.strain > 15) return RED;
  return YELLOW;
}

type TooltipPayload = { payload: ChartPoint };

function ScatterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const color = colorFor(p);
  return (
    <div
      style={{
        background: "rgba(12,12,18,0.92)",
        border: `1px solid ${color}66`,
        borderRadius: 8,
        padding: "6px 10px",
        backdropFilter: "blur(8px)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <div style={{ color: "var(--fg-3)", marginBottom: 4 }}>{formatLongDate(p.date)}</div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span style={{ color: "var(--fg-3)" }}>strain</span>
        <span style={{ color: "var(--fg-1)", fontVariantNumeric: "tabular-nums" }}>
          {p.strain.toFixed(1)}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span style={{ color: "var(--fg-3)" }}>recovery</span>
        <span style={{ color, fontVariantNumeric: "tabular-nums" }}>
          {p.recovery.toFixed(0)}%
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span style={{ color: "var(--fg-3)" }}>sleep</span>
        <span style={{ color: "var(--fg-2)", fontVariantNumeric: "tabular-nums" }}>
          {p.sleep_hours != null ? `${p.sleep_hours.toFixed(1)}h` : "—"}
        </span>
      </div>
    </div>
  );
}

export default function StrainRecoveryScatter({
  rows,
  rangeLabel,
}: {
  rows: ScatterRow[];
  rangeLabel: string;
}) {
  const valid: ChartPoint[] = rows
    .filter(
      (r): r is { date: string; strain: number; recovery: number; sleep_hours: number | null } =>
        r.strain != null &&
        Number.isFinite(r.strain) &&
        r.recovery != null &&
        Number.isFinite(r.recovery)
    )
    .map((r) => ({
      date: r.date,
      strain: r.strain,
      recovery: r.recovery,
      sleep_hours: r.sleep_hours,
    }));

  if (valid.length < 7) {
    return (
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: GREEN, color: GREEN }} />
              Strain vs recovery
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>{rangeLabel} scatter</div>
          </div>
        </div>
        <div className="empty-state">
          <div className="title">Need 7+ days of strain + recovery</div>
          <div className="sub">Sync more days to populate this chart</div>
        </div>
      </div>
    );
  }

  const red = valid.filter((p) => p.recovery < 33 && p.strain > 15);
  const green = valid.filter((p) => p.recovery > 66);
  const yellow = valid.filter(
    (p) => !(p.recovery > 66) && !(p.recovery < 33 && p.strain > 15)
  );

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: GREEN, color: GREEN }} />
            Strain vs recovery
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            {rangeLabel} · {valid.length} points
          </div>
        </div>
        <span className="card-sub">
          <span style={{ color: GREEN }}>green &gt;66</span>
          {" · "}
          <span style={{ color: YELLOW }}>mid</span>
          {" · "}
          <span style={{ color: RED }}>red &lt;33 + high strain</span>
        </span>
      </div>
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 16, bottom: 28, left: 8 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" />
            <XAxis
              type="number"
              dataKey="strain"
              domain={[0, 21]}
              ticks={[0, 5, 10, 15, 20]}
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
              label={{
                value: "Strain",
                position: "insideBottom",
                offset: -16,
                fill: "var(--fg-3)",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
              }}
            />
            <YAxis
              type="number"
              dataKey="recovery"
              domain={[0, 100]}
              ticks={[0, 33, 66, 100]}
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              width={36}
              tickFormatter={(v: number) => `${v}%`}
              label={{
                value: "Recovery",
                angle: -90,
                position: "insideLeft",
                offset: 16,
                fill: "var(--fg-3)",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
              }}
            />
            <ZAxis range={[60, 60]} />
            <ReferenceLine y={33} stroke={RED} strokeDasharray="3 3" strokeOpacity={0.35} />
            <ReferenceLine y={66} stroke={GREEN} strokeDasharray="3 3" strokeOpacity={0.35} />
            <Tooltip content={<ScatterTooltip />} cursor={{ stroke: "rgba(255,255,255,0.12)" }} />
            <Scatter data={green} fill={GREEN} fillOpacity={0.85} />
            <Scatter data={yellow} fill={YELLOW} fillOpacity={0.85} />
            <Scatter data={red} fill={RED} fillOpacity={0.95} shape="circle" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {red.length > 0 && (
        <div
          style={{
            marginTop: 10,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "#ff8888",
          }}
        >
          {red.length} red-zone {red.length === 1 ? "day" : "days"} (high strain on low recovery)
        </div>
      )}
    </div>
  );
}
