"use client";

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { NapImpact, NapWithStartHour } from "@/lib/analytics/naps";

type Props = { naps: NapWithStartHour[]; impact: NapImpact; rangeLabel: string };

const MS_PER_MIN = 60_000;

function formatHM(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatLongDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function clockHour(h: number): string {
  const norm = ((h % 24) + 24) % 24;
  const hh = Math.floor(norm);
  const mm = Math.round((norm - hh) * 60);
  const period = hh >= 12 ? "pm" : "am";
  const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
  return `${h12}:${mm.toString().padStart(2, "0")}${period}`;
}

type NapPoint = {
  date: string;
  dateIndex: number;
  start_hour: number;
  durationMin: number;
};

function NapTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: NapPoint }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
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
        {clockHour(d.start_hour)} · {formatHM(d.durationMin)}
      </div>
    </div>
  );
}

export default function NapTrackerCard({ naps, impact, rangeLabel }: Props) {
  const points: NapPoint[] = naps
    .filter((n) => n.start_hour != null && n.duration_ms != null)
    .map((n, i) => ({
      date: n.date,
      dateIndex: i,
      start_hour: n.start_hour as number,
      durationMin: (n.duration_ms ?? 0) / MS_PER_MIN,
    }));

  const dateLabels = points.map((p) => p.date);

  if (impact.totalNaps < 2) {
    return (
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
              Nap impact
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>Need 2+ naps to compare</div>
          </div>
        </div>
        <div className="empty-state">
          <div className="title">Not enough naps yet</div>
          <div className="sub">Take a nap (or wait for one to be logged)</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
            Nap impact
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            {rangeLabel} · timing + with-vs-without nightly sleep comparison
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
        <KPI label="Total naps" value={`${impact.totalNaps}`} />
        <KPI label="Avg duration" value={impact.avgDurationMin > 0 ? formatHM(impact.avgDurationMin) : "—"} />
        <KPI
          label="Avg need credit"
          value={
            impact.avgSleepNeedReductionHrs != null
              ? `${impact.avgSleepNeedReductionHrs.toFixed(1)}h`
              : "—"
          }
        />
      </div>
      {points.length >= 2 && (
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 6, right: 12, left: 0, bottom: 24 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" />
              <XAxis
                type="number"
                dataKey="dateIndex"
                domain={[0, Math.max(0, points.length - 1)]}
                tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                tickLine={false}
                tickFormatter={(v: number) => {
                  const i = Math.round(v);
                  if (i < 0 || i >= dateLabels.length) return "";
                  return new Date(dateLabels[i] + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
                }}
                interval={Math.max(0, Math.floor(points.length / 6))}
              />
              <YAxis
                type="number"
                dataKey="start_hour"
                domain={[6, 22]}
                tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                axisLine={false}
                tickLine={false}
                width={56}
                tickFormatter={(v: number) => clockHour(v)}
              />
              <ZAxis type="number" dataKey="durationMin" range={[40, 320]} />
              <Tooltip content={<NapTooltip />} cursor={{ stroke: "rgba(255,255,255,0.12)" }} />
              <Scatter data={points} fill="#00d4aa" fillOpacity={0.65} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
      <ComparisonTable impact={impact} />
    </div>
  );
}

function ComparisonTable({ impact }: { impact: NapImpact }) {
  const rows: { label: string; with: string; without: string }[] = [
    {
      label: "Sleep performance",
      with: impact.withNap.perf != null ? `${impact.withNap.perf.toFixed(0)}%` : "—",
      without: impact.withoutNap.perf != null ? `${impact.withoutNap.perf.toFixed(0)}%` : "—",
    },
    {
      label: "Sleep efficiency",
      with: impact.withNap.eff != null ? `${impact.withNap.eff.toFixed(0)}%` : "—",
      without: impact.withoutNap.eff != null ? `${impact.withoutNap.eff.toFixed(0)}%` : "—",
    },
    {
      label: "Deep sleep",
      with: impact.withNap.deepHrs != null ? `${impact.withNap.deepHrs.toFixed(2)}h` : "—",
      without: impact.withoutNap.deepHrs != null ? `${impact.withoutNap.deepHrs.toFixed(2)}h` : "—",
    },
  ];

  return (
    <div style={{ marginTop: 14, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1fr",
          padding: "8px 12px",
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: "var(--fg-3)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <span></span>
        <span>with nap (n={impact.withNap.n})</span>
        <span>without nap (n={impact.withoutNap.n})</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.label}
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr 1fr",
            padding: "6px 12px",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--fg-1)",
            borderTop: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <span style={{ color: "var(--fg-3)" }}>{r.label}</span>
          <span style={{ color: "#00d4aa" }}>{r.with}</span>
          <span>{r.without}</span>
        </div>
      ))}
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
