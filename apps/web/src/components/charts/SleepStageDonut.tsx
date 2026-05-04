"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { SleepRow } from "@/lib/db";

type Props = { row: SleepRow | null };

const STAGE_COLORS = {
  Light: "#00d4aa",
  REM: "#7b61ff",
  Deep: "#0055ff",
  Awake: "#3f3f46",
} as const;

function formatHM(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

type StageDatum = { name: keyof typeof STAGE_COLORS; ms: number };

type DonutTooltipPayload = { payload: StageDatum };

function DonutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: DonutTooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div
      style={{
        background: "rgba(12,12,18,0.92)",
        border: `1px solid ${STAGE_COLORS[d.name]}44`,
        borderRadius: 8,
        padding: "6px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <div style={{ color: STAGE_COLORS[d.name], fontWeight: 600, marginBottom: 2 }}>{d.name}</div>
      <div style={{ color: "var(--fg-2)" }}>{formatHM(d.ms)}</div>
    </div>
  );
}

export default function SleepStageDonut({ row }: Props) {
  if (!row) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
            Last night stages
          </div>
        </div>
        <div className="empty-state">
          <div className="title">No sleep data yet</div>
          <div className="sub">Sync Whoop to see stage breakdown</div>
        </div>
      </div>
    );
  }

  const stages: StageDatum[] = [
    { name: "Light", ms: row.light_ms ?? 0 },
    { name: "REM", ms: row.rem_ms ?? 0 },
    { name: "Deep", ms: row.deep_ms ?? 0 },
    { name: "Awake", ms: row.awake_ms ?? 0 },
  ];
  const total = stages.reduce((a, b) => a + b.ms, 0);

  if (total === 0) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
            Last night stages
          </div>
        </div>
        <div className="empty-state">
          <div className="title">No stage data</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
            Last night stages
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            {new Date(row.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          </div>
        </div>
      </div>
      <div style={{ position: "relative", height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={stages}
              dataKey="ms"
              nameKey="name"
              innerRadius="60%"
              outerRadius="92%"
              startAngle={90}
              endAngle={-270}
              stroke="rgba(0,0,0,0.4)"
              strokeWidth={1}
            >
              {stages.map((s) => (
                <Cell key={s.name} fill={STAGE_COLORS[s.name]} />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)" }}>Total</div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 26,
              fontWeight: 500,
              letterSpacing: "-0.02em",
              fontVariantNumeric: "tabular-nums",
              color: "var(--fg-1)",
            }}
          >
            {formatHM(total)}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
        {stages.map((s) => {
          const pct = (s.ms / total) * 100;
          return (
            <div key={s.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 56 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: STAGE_COLORS[s.name],
                    display: "inline-block",
                  }}
                />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)" }}>{s.name}</span>
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 14, color: "var(--fg-1)", fontVariantNumeric: "tabular-nums" }}>
                {pct.toFixed(0)}%
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--fg-3)" }}>{formatHM(s.ms)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
