"use client";

import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CycleRow } from "@/lib/db";

const COLOR_CTL = "#00aaff";
const COLOR_ATL = "#ffaa00";
const COLOR_TSB_FRESH = "#00d4aa";
const COLOR_TSB_FATIGUE = "#ff3b3b";

const CTL_SPAN = 42;
const ATL_SPAN = 7;
const DISPLAY_DAYS = 90;

type ChartRow = {
  date: string;
  shortDate: string;
  fullDate: string;
  ctl: number;
  atl: number;
  tsbPos: number | null;
  tsbNeg: number | null;
  tsb: number;
};

function computeTSB(rows: CycleRow[]): ChartRow[] {
  if (rows.length === 0) return [];
  const alphaCtl = 2 / (CTL_SPAN + 1);
  const alphaAtl = 2 / (ATL_SPAN + 1);
  const seed = rows[0].strain ?? 0;
  let ctl = seed;
  let atl = seed;
  const raw: { date: string; ctl: number; atl: number; tsb: number }[] = [];
  for (const r of rows) {
    const s = r.strain ?? 0;
    ctl = alphaCtl * s + (1 - alphaCtl) * ctl;
    atl = alphaAtl * s + (1 - alphaAtl) * atl;
    raw.push({ date: r.date, ctl, atl, tsb: ctl - atl });
  }

  return raw.slice(-DISPLAY_DAYS).map((r, i, arr) => {
    const prev = i > 0 ? arr[i - 1] : null;
    const signFlipped = prev != null && Math.sign(prev.tsb) !== Math.sign(r.tsb) && prev.tsb !== 0 && r.tsb !== 0;
    const tsbPos = r.tsb >= 0 ? r.tsb : signFlipped ? 0 : null;
    const tsbNeg = r.tsb < 0 ? r.tsb : signFlipped ? 0 : null;
    const d = new Date(r.date + "T00:00:00");
    return {
      date: r.date,
      shortDate: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      fullDate: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      ctl: Number(r.ctl.toFixed(2)),
      atl: Number(r.atl.toFixed(2)),
      tsb: Number(r.tsb.toFixed(2)),
      tsbPos: tsbPos != null ? Number(tsbPos.toFixed(2)) : null,
      tsbNeg: tsbNeg != null ? Number(tsbNeg.toFixed(2)) : null,
    };
  });
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const tsbColor = row.tsb >= 0 ? COLOR_TSB_FRESH : COLOR_TSB_FATIGUE;
  return (
    <div
      style={{
        background: "rgba(12,12,18,0.92)",
        border: `1px solid ${tsbColor}44`,
        borderRadius: 8,
        padding: "6px 10px",
        backdropFilter: "blur(8px)",
        boxShadow: `0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px ${tsbColor}22`,
        whiteSpace: "nowrap",
      }}
    >
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)", marginBottom: 4 }}>
        {row.fullDate}
      </div>
      <Row label="CTL (fitness)" value={row.ctl.toFixed(1)} color={COLOR_CTL} />
      <Row label="ATL (fatigue)" value={row.atl.toFixed(1)} color={COLOR_ATL} />
      <Row label="TSB (form)" value={`${row.tsb >= 0 ? "+" : ""}${row.tsb.toFixed(1)}`} color={tsbColor} bold />
    </div>
  );
}

function Row({ label, value, color, bold }: { label: string; value: string; color: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--fg-3)", minWidth: 80 }}>{label}</span>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: bold ? 15 : 12,
          fontWeight: bold ? 500 : 400,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export default function TSBCurve({ rows }: { rows: CycleRow[] }) {
  const data = computeTSB(rows);
  if (data.length < 14) {
    return (
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: COLOR_CTL, color: COLOR_CTL }} />
              Fitness · Fatigue · Form (TSB)
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              CTL 42d EWM · ATL 7d EWM · TSB = CTL − ATL
            </div>
          </div>
        </div>
        <div className="empty-state">
          <div className="title">Need more strain history</div>
          <div className="sub">TSB stabilises after ~6 weeks of data</div>
        </div>
      </div>
    );
  }

  const today = data[data.length - 1];
  const tsbColor = today.tsb >= 0 ? COLOR_TSB_FRESH : COLOR_TSB_FATIGUE;
  const tsbLabel = today.tsb >= 0 ? "fresh" : "fatigued";

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: tsbColor, color: tsbColor }} />
            Fitness · Fatigue · Form (TSB)
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            CTL 42d EWM · ATL 7d EWM · TSB = CTL − ATL · last {data.length} days
          </div>
        </div>
        <span className="card-sub">
          Today&nbsp;
          <span style={{ color: tsbColor }}>
            TSB {today.tsb >= 0 ? "+" : ""}{today.tsb.toFixed(1)} · {tsbLabel}
          </span>
        </span>
      </div>
      <div className="chart-body" style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="shortDate"
              stroke="var(--fg-3)"
              tickLine={false}
              axisLine={false}
              tick={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
              minTickGap={24}
            />
            <YAxis
              stroke="var(--fg-3)"
              tickLine={false}
              axisLine={false}
              tick={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
              width={32}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: "rgba(255,255,255,0.12)", strokeWidth: 1 }} />
            <Legend
              verticalAlign="top"
              height={28}
              iconType="line"
              wrapperStyle={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)" }}
            />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" strokeDasharray="2 2" />
            <Line
              type="monotone"
              dataKey="ctl"
              name="CTL (fitness)"
              stroke={COLOR_CTL}
              strokeWidth={1.8}
              dot={false}
              activeDot={{ r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="atl"
              name="ATL (fatigue)"
              stroke={COLOR_ATL}
              strokeWidth={1.8}
              dot={false}
              activeDot={{ r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="tsbPos"
              name="TSB (form)"
              stroke={COLOR_TSB_FRESH}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="tsbNeg"
              stroke={COLOR_TSB_FATIGUE}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              connectNulls={false}
              legendType="none"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
