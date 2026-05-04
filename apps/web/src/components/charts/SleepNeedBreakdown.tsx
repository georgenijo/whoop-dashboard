"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { SleepRow } from "@/lib/db";

type Props = { row: SleepRow | null };

const COMPONENT_COLORS = {
  Baseline: "#7b61ff",
  Debt: "#ff4444",
  Strain: "#ffaa00",
  "Nap credit": "#00d4aa",
} as const;

type ComponentKey = keyof typeof COMPONENT_COLORS;

function formatHM(ms: number): string {
  const totalMinutes = Math.round(Math.abs(ms) / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

type StackDatum = {
  category: string;
  Baseline: number;
  Debt: number;
  Strain: number;
};

type TooltipPayload = {
  name: string;
  value: number;
  color: string;
};

function StackTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "rgba(12,12,18,0.92)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8,
        padding: "6px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: {formatHM(p.value)}
        </div>
      ))}
    </div>
  );
}

export default function SleepNeedBreakdown({ row }: Props) {
  if (
    !row ||
    row.need_from_baseline_ms == null ||
    row.need_from_debt_ms == null ||
    row.need_from_strain_ms == null ||
    row.need_from_nap_ms == null
  ) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
            Sleep need breakdown
          </div>
        </div>
        <div className="empty-state">
          <div className="title">No need breakdown yet</div>
          <div className="sub">Sync Whoop to populate components</div>
        </div>
      </div>
    );
  }

  const baseline = row.need_from_baseline_ms;
  const debt = row.need_from_debt_ms;
  const strain = row.need_from_strain_ms;
  // Whoop's nap component is typically negative (a credit reducing need).
  const napCreditMs = Math.abs(row.need_from_nap_ms);
  const total = baseline + debt + strain - napCreditMs;

  const data: StackDatum[] = [
    {
      category: "Tonight",
      Baseline: baseline,
      Debt: debt,
      Strain: strain,
    },
  ];

  const components: Array<{ key: ComponentKey; ms: number; sign: 1 | -1 }> = [
    { key: "Baseline", ms: baseline, sign: 1 },
    { key: "Debt", ms: debt, sign: 1 },
    { key: "Strain", ms: strain, sign: 1 },
    { key: "Nap credit", ms: napCreditMs, sign: -1 },
  ];

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
            Sleep need breakdown
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            {new Date(row.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          </div>
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 26,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            color: "var(--fg-1)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatHM(total)}
        </div>
      </div>
      <div style={{ height: 80 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="category" hide />
            <Tooltip content={<StackTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <Bar dataKey="Baseline" stackId="need" fill={COMPONENT_COLORS.Baseline} radius={[6, 0, 0, 6]}>
              <Cell fill={COMPONENT_COLORS.Baseline} />
            </Bar>
            <Bar dataKey="Debt" stackId="need" fill={COMPONENT_COLORS.Debt} />
            <Bar dataKey="Strain" stackId="need" fill={COMPONENT_COLORS.Strain} radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
        {components.map((c) => (
          <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: COMPONENT_COLORS[c.key],
                display: "inline-block",
              }}
            />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)" }}>{c.key}</span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: c.sign === -1 ? "#00d4aa" : "var(--fg-1)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {c.sign === -1 ? "−" : ""}{formatHM(c.ms)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
