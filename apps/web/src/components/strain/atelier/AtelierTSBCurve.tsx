"use client";

import {
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CycleRow } from "@/lib/db";

const CTL_SPAN = 42;
const ATL_SPAN = 7;
const DISPLAY_DAYS = 90;

type ChartRow = {
  date: string;
  shortDate: string;
  fullDate: string;
  ctl: number;
  atl: number;
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
  return raw.slice(-DISPLAY_DAYS).map((r) => {
    const d = new Date(r.date + "T00:00:00");
    return {
      date: r.date,
      shortDate: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      fullDate: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      ctl: Number(r.ctl.toFixed(2)),
      atl: Number(r.atl.toFixed(2)),
      tsb: Number(r.tsb.toFixed(2)),
    };
  });
}

function AtelierTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChartRow }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const tsbPositive = row.tsb >= 0;
  return (
    <div
      style={{
        background: "var(--bone)",
        border: "1px solid var(--line)",
        padding: "8px 12px",
        fontFamily: "var(--font-display-sans)",
        fontSize: 11,
        color: "var(--ink-soft)",
        whiteSpace: "nowrap",
      }}
    >
      <div style={{ fontSize: 9, letterSpacing: "0.1em", color: "var(--ink-faint)", marginBottom: 6, textTransform: "uppercase" }}>
        {row.fullDate}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span>
          <span style={{ color: "var(--ink-faint)", fontSize: 9 }}>CTL (fitness) </span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{row.ctl.toFixed(1)}</span>
        </span>
        <span>
          <span style={{ color: "var(--ink-faint)", fontSize: 9 }}>ATL (fatigue) </span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{row.atl.toFixed(1)}</span>
        </span>
        <span>
          <span style={{ color: "var(--ink-faint)", fontSize: 9 }}>TSB (form) </span>
          <span
            style={{
              fontVariantNumeric: "tabular-nums",
              color: tsbPositive ? "var(--olive)" : "var(--coral)",
              fontWeight: 600,
            }}
          >
            {row.tsb >= 0 ? "+" : ""}{row.tsb.toFixed(1)}
          </span>
        </span>
      </div>
    </div>
  );
}

export default function AtelierTSBCurve({ rows }: { rows: CycleRow[] }) {
  const data = computeTSB(rows);

  if (data.length < 14) {
    return (
      <div className="atelier-tsb-plate">
        <div className="atelier-plate-head">
          <span className="atelier-plate-fig">Plate N&#xba; 06 / FIG. TSB-CURVE</span>
          <span className="atelier-plate-page">fitness · fatigue · form</span>
        </div>
        <p className="atelier-chart-empty">Need ~6 weeks of strain data for TSB to stabilise.</p>
      </div>
    );
  }

  const today = data[data.length - 1];
  const tsbFresh = today.tsb >= 0;

  return (
    <div className="atelier-tsb-plate">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">VI. Plate N&#xba; 06 / FIG. TSB-CURVE</span>
        <span className="atelier-plate-page">CTL 42d · ATL 7d · last {data.length}d</span>
      </div>

      <div className="atelier-tsb-legend">
        <div className="atelier-tsb-legend-item">
          <div className="atelier-tsb-legend-swatch" style={{ background: "var(--ink-mute)" }} />
          CTL — fitness (42d EWM)
        </div>
        <div className="atelier-tsb-legend-item">
          <div className="atelier-tsb-legend-swatch" style={{ borderTop: "1px dashed var(--ink-faint)", background: "none" }} />
          ATL — fatigue (7d EWM)
        </div>
        <div className="atelier-tsb-legend-item">
          <div className="atelier-tsb-legend-swatch" style={{ background: tsbFresh ? "var(--olive)" : "var(--coral)" }} />
          TSB — form (CTL − ATL)
        </div>
      </div>

      <div className="atelier-tsb-chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="shortDate"
              stroke="var(--ink-faint)"
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
              tick={{
                fontFamily: "var(--font-display-sans)",
                fontSize: 9,
                fill: "var(--ink-faint)",
                letterSpacing: "0.04em",
              }}
              minTickGap={32}
            />
            <YAxis
              stroke="var(--ink-faint)"
              tickLine={false}
              axisLine={false}
              tick={{
                fontFamily: "var(--font-display-sans)",
                fontSize: 9,
                fill: "var(--ink-faint)",
              }}
              width={28}
            />
            <Tooltip
              content={<AtelierTooltip />}
              cursor={{ stroke: "var(--line)", strokeWidth: 1 }}
            />
            <ReferenceLine
              y={0}
              stroke="var(--line)"
              strokeDasharray="3 3"
            />
            <Line
              type="monotone"
              dataKey="ctl"
              name="CTL"
              stroke="var(--ink-mute)"
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, fill: "var(--ink-mute)", stroke: "none" }}
            />
            <Line
              type="monotone"
              dataKey="atl"
              name="ATL"
              stroke="var(--ink-faint)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              activeDot={{ r: 3, fill: "var(--ink-faint)", stroke: "none" }}
            />
            <Line
              type="monotone"
              dataKey="tsb"
              name="TSB"
              stroke={tsbFresh ? "var(--olive)" : "var(--coral)"}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, stroke: "none" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="atelier-tsb-today">
        <span className="atelier-tsb-today-label">Today</span>
        <span>
          <span style={{ color: "var(--ink-faint)", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", marginRight: 4 }}>CTL</span>
          <span className="atelier-tsb-today-val">{today.ctl.toFixed(1)}</span>
        </span>
        <span>
          <span style={{ color: "var(--ink-faint)", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", marginRight: 4 }}>ATL</span>
          <span className="atelier-tsb-today-val">{today.atl.toFixed(1)}</span>
        </span>
        <span>
          <span style={{ color: "var(--ink-faint)", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", marginRight: 4 }}>TSB</span>
          <span className={`atelier-tsb-today-val ${tsbFresh ? "fresh" : "fatigued"}`}>
            {today.tsb >= 0 ? "+" : ""}{today.tsb.toFixed(1)} · {tsbFresh ? "fresh" : "fatigued"}
          </span>
        </span>
      </div>
    </div>
  );
}
