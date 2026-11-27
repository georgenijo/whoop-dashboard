"use client";

import type { CSSProperties } from "react";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import type { SeriesSummary } from "./chartSummary";

type TooltipEntry = {
  value?: number | string | null;
  name?: string | number;
  color?: string;
  dataKey?: string | number;
};

/** A presentation-block number with its unit, or "Not available". */
export function formatBlockNumber(value: number | null, unit = ""): string {
  if (value === null) return "Not available";
  return `${value.toLocaleString("en-US")}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`;
}

export function formatChartValue(value: number, unit: string): string {
  const text = value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (!unit) return text;
  return unit === "%" ? `${text}%` : `${text} ${unit}`;
}

/**
 * One tooltip for every Coach chart: the period on top, then each series as
 * a colored row. `units` maps a series' dataKey to its unit.
 */
export function CoachChartTooltip({
  active,
  payload,
  label,
  units,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  units: Record<string, string>;
}) {
  const rows = (payload ?? []).filter((entry) => typeof entry.value === "number");
  if (!active || rows.length === 0) return null;
  return (
    <div className="coach-inline-chart-tooltip">
      <span>{label}</span>
      {rows.map((entry) => (
        <strong key={String(entry.dataKey ?? entry.name)} style={{ "--series-color": entry.color } as CSSProperties}>
          {rows.length > 1 ? <em>{entry.name}</em> : null}
          {formatChartValue(entry.value as number, units[String(entry.dataKey)] ?? "")}
        </strong>
      ))}
    </div>
  );
}

/**
 * Recharts `dot` renderer that draws nothing except at the last point, where
 * it places a solid dot with a slow halo — the "now" of the series.
 */
export function liveDot(lastIndex: number, color: string) {
  function LiveDot(props: { cx?: number; cy?: number; index?: number; value?: unknown }) {
    const { cx, cy, index } = props;
    if (index !== lastIndex || cx == null || cy == null || props.value == null) {
      return <g key={`dot-${index}`} />;
    }
    return (
      <g key={`dot-${index}`} className="coach-chart-live-dot" style={{ color }}>
        <circle className="coach-chart-live-halo" cx={cx} cy={cy} r={9} />
        <circle cx={cx} cy={cy} r={4} fill="currentColor" stroke="var(--bg-sunk)" strokeWidth={2} />
      </g>
    );
  }
  return LiveDot;
}

export function AreaGradient({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={0.32} />
      <stop offset="70%" stopColor={color} stopOpacity={0.06} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  );
}

/** The chart's lead number: the latest value, animated, with its movement. */
export function ChartHeadline({ summary, color, label }: { summary: SeriesSummary | null; color: string; label?: string }) {
  if (!summary) return null;
  return (
    <div className="coach-chart-headline" style={{ "--metric-accent": color } as CSSProperties}>
      {label ? <span className="coach-chart-headline-label">{label}</span> : null}
      <AnimatedNumber className="coach-chart-headline-value" value={summary.latest} />
      {summary.change ? (
        <span className={`coach-chart-headline-change is-${summary.direction}`}>{summary.change}</span>
      ) : null}
    </div>
  );
}

export function ViewSwitch({ view, onChange }: { view: "chart" | "table"; onChange: (view: "chart" | "table") => void }) {
  return (
    <div className="coach-inline-chart-switch" role="group" aria-label="Visualization view" data-view={view}>
      {(["chart", "table"] as const).map((mode) => (
        <button
          type="button"
          className={view === mode ? "active" : ""}
          aria-pressed={view === mode}
          onClick={() => onChange(mode)}
          key={mode}
        >
          {mode === "chart" ? "Chart" : "Table"}
        </button>
      ))}
    </div>
  );
}
