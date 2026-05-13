"use client";

import { useState, useId } from "react";
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

const SLEEP_NEED_EXPLANATION =
  "Sleep Need = Baseline (your nightly baseline set by Whoop) + Strain add-on (extra sleep earned by recent activity) + Sleep debt (deficit carried from recent under-sleep) − Nap credit (any sleep already logged as a nap).";

function InfoIcon({ explanation }: { explanation: string }) {
  const [visible, setVisible] = useState(false);
  const tooltipId = useId();
  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <span
        tabIndex={0}
        aria-describedby={tooltipId}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: "1px solid rgba(255,255,255,0.25)",
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: "var(--fg-3)",
          cursor: "default",
          userSelect: "none",
          lineHeight: 1,
        }}
      >
        i
      </span>
      {visible && (
        <span
          id={tooltipId}
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            width: 240,
            background: "rgba(12,12,18,0.96)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            padding: "8px 10px",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--fg-2)",
            lineHeight: 1.5,
            zIndex: 20,
            pointerEvents: "none",
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
          }}
        >
          {explanation}
        </span>
      )}
    </span>
  );
}

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
            Sleep need breakdown{" "}
            <InfoIcon explanation={SLEEP_NEED_EXPLANATION} />
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
  // need_from_nap_ms is always non-positive per Whoop API (a credit reducing need).
  const napCreditMs = row.need_from_nap_ms < 0 ? Math.abs(row.need_from_nap_ms) : 0;
  // Use the pre-computed value from the DB to keep header and bar consistent.
  const total = row.sleep_need_ms ?? (baseline + debt + strain - napCreditMs);

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
    ...(napCreditMs > 0 ? [{ key: "Nap credit" as ComponentKey, ms: napCreditMs, sign: -1 as const }] : []),
  ];

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
            Sleep need breakdown{" "}
            <InfoIcon explanation={SLEEP_NEED_EXPLANATION} />
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
