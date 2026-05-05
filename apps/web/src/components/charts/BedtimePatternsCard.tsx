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
import type { BedtimePatternsResult } from "@/lib/analytics/bedtime";
import { BEDTIME_ANCHOR_HOUR } from "@/lib/analytics/bedtime";

type Props = { result: BedtimePatternsResult | null };

function formatTickDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatLongDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function clockFromAnchor(hoursFromAnchor: number, anchor: number): string {
  const h24 = (anchor + hoursFromAnchor) % 24;
  const hh = Math.floor(h24);
  const mm = Math.round((h24 - hh) * 60);
  const period = hh >= 12 ? "pm" : "am";
  const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
  return `${h12}:${mm.toString().padStart(2, "0")}${period}`;
}

function clockFromHour(h24: number): string {
  const norm = ((h24 % 24) + 24) % 24;
  const hh = Math.floor(norm);
  const mm = Math.round((norm - hh) * 60);
  const period = hh >= 12 ? "pm" : "am";
  const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
  return `${h12}:${mm.toString().padStart(2, "0")}${period}`;
}

type SeriesPoint = { date: string; bedtimeHour: number; rolling7: number | null };

function PatternsTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: SeriesPoint }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div
      style={{
        background: "rgba(12,12,18,0.92)",
        border: "1px solid #00aaff66",
        borderRadius: 8,
        padding: "6px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <div style={{ color: "var(--fg-3)", marginBottom: 2 }}>{formatLongDate(d.date)}</div>
      <div style={{ color: "var(--fg-1)" }}>
        bedtime {clockFromAnchor(d.bedtimeHour, BEDTIME_ANCHOR_HOUR)}
      </div>
      {d.rolling7 != null && (
        <div style={{ color: "var(--fg-3)", fontSize: 10, marginTop: 2 }}>
          7d avg {clockFromAnchor(d.rolling7, BEDTIME_ANCHOR_HOUR)}
        </div>
      )}
    </div>
  );
}

export default function BedtimePatternsCard({ result }: Props) {
  if (!result) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "#00aaff", color: "#00aaff" }} />
            Bedtime patterns
          </div>
        </div>
        <div className="empty-state">
          <div className="title">Need at least 5 nights with bedtime data</div>
          <div className="sub">Backfill or sync to populate</div>
        </div>
      </div>
    );
  }

  const minHour = Math.min(...result.series.map((s) => s.bedtimeHour));
  const maxHour = Math.max(...result.series.map((s) => s.bedtimeHour));
  const yDomain = [Math.max(0, Math.floor(minHour - 0.5)), Math.ceil(maxHour + 0.5)];

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#00aaff", color: "#00aaff" }} />
            Bedtime patterns
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            Regularity + weekday vs weekend
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
        <KPI label="Bedtime σ" value={`${Math.round(result.bedtime_std_min)}m`} />
        <KPI label="Wake σ" value={`${Math.round(result.wake_std_min)}m`} />
        <KPI
          label="Weekend shift"
          value={`${result.social_jet_lag_min >= 0 ? "+" : ""}${Math.round(result.social_jet_lag_min)}m`}
        />
      </div>
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={result.series} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatTickDate}
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
            />
            <YAxis
              type="number"
              domain={yDomain}
              tickFormatter={(v: number) => clockFromAnchor(v, BEDTIME_ANCHOR_HOUR)}
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <ZAxis range={[40, 40]} />
            <Tooltip content={<PatternsTooltip />} cursor={{ stroke: "rgba(255,255,255,0.12)" }} />
            <Scatter dataKey="bedtimeHour" fill="#00aaff" />
            <Line
              dataKey="rolling7"
              stroke="#7b61ff"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 14 }}>
        <Tile
          label="Bedtime"
          wd={clockFromHour(result.weekday.avgBedtimeHour)}
          we={clockFromHour(result.weekend.avgBedtimeHour)}
        />
        <Tile
          label="Wake"
          wd={clockFromHour(result.weekday.avgWakeHour)}
          we={clockFromHour(result.weekend.avgWakeHour)}
        />
        <Tile
          label="Sleep"
          wd={`${result.weekday.avgSleepHrs.toFixed(1)}h`}
          we={`${result.weekend.avgSleepHrs.toFixed(1)}h`}
        />
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

function Tile({ label, wd, we }: { label: string; wd: string; we: string }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 6,
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--fg-3)" }}>{label}</span>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-1)" }}>WD {wd}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#7b61ff" }}>WE {we}</span>
      </div>
    </div>
  );
}
