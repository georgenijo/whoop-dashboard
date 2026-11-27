"use client";

import { type CSSProperties, useId, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePrefersReducedMotion } from "@/components/motion/AnimatedNumber";
import type { CoachChartSpec } from "@/lib/coach/visualization";
import { accentVar, metricAccent } from "@/lib/motion";
import {
  AreaGradient,
  ChartHeadline,
  CoachChartTooltip,
  ViewSwitch,
  formatChartValue,
  liveDot,
} from "./CoachChartParts";
import { summarizeSeries, svgSafeId } from "./chartSummary";

const AXIS_TICK = { fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-num)" };
const MARGIN = { top: 12, right: 12, bottom: 0, left: -12 };

export default function CoachInlineChart({ chart }: { chart: CoachChartSpec }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const reduced = usePrefersReducedMotion();
  const gradientId = `coach-area-${svgSafeId(useId())}`;
  const color = accentVar(metricAccent(chart.title, chart.unit));
  const data = useMemo(
    () => chart.labels.map((label, index) => ({ label, value: chart.values[index] })),
    [chart.labels, chart.values],
  );
  const summary = useMemo(() => summarizeSeries(chart.values, chart.unit), [chart.unit, chart.values]);
  const domain: [number | "auto", number | "auto"] = [chart.yMin ?? "auto", chart.yMax ?? "auto"];
  const units = { value: chart.unit };
  const lastIndex = data.length - 1;
  const motion = {
    isAnimationActive: !reduced,
    animationDuration: 900,
    animationEasing: "ease-out" as const,
  };

  return (
    <section
      className="coach-inline-chart"
      aria-label={chart.title}
      style={{ "--metric-accent": color } as CSSProperties}
    >
      <div className="coach-inline-chart-head">
        <div className="coach-inline-chart-title">
          <h3>{chart.title}</h3>
          <span>{chart.type === "line" ? "Trend" : "Comparison"}{chart.unit ? ` · ${chart.unit}` : ""}</span>
        </div>
        <ViewSwitch view={view} onChange={setView} />
      </div>
      <ChartHeadline summary={summary} color={color} />

      {view === "chart" ? (
        <div className="coach-inline-chart-plot coach-view-enter" role="img" aria-label={`${chart.title} chart`}>
          <ResponsiveContainer width="100%" height="100%">
            {chart.type === "line" ? (
              <AreaChart data={data} margin={MARGIN}>
                <defs>
                  <AreaGradient id={gradientId} color={color} />
                </defs>
                <CartesianGrid stroke="var(--rule-soft)" strokeDasharray="2 5" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} tick={AXIS_TICK} />
                <YAxis domain={domain} tickLine={false} axisLine={false} width={48} tick={AXIS_TICK} />
                <Tooltip
                  content={<CoachChartTooltip units={units} />}
                  cursor={{ stroke: color, strokeOpacity: 0.45, strokeDasharray: "3 3" }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={color}
                  strokeWidth={2.25}
                  strokeLinecap="round"
                  fill={`url(#${gradientId})`}
                  dot={liveDot(lastIndex, color)}
                  activeDot={{ r: 5, fill: color, stroke: "var(--bg-sunk)", strokeWidth: 2 }}
                  {...motion}
                />
              </AreaChart>
            ) : (
              <BarChart data={data} margin={MARGIN}>
                <CartesianGrid stroke="var(--rule-soft)" strokeDasharray="2 5" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} tick={AXIS_TICK} />
                <YAxis domain={domain} tickLine={false} axisLine={false} width={48} tick={AXIS_TICK} />
                <Tooltip content={<CoachChartTooltip units={units} />} cursor={{ fill: "var(--bg-lift)", radius: 6 } as object} />
                <Bar dataKey="value" radius={[6, 6, 2, 2]} maxBarSize={44} {...motion}>
                  {data.map((row, index) => (
                    <Cell
                      key={`${row.label}:${index}`}
                      fill={color}
                      fillOpacity={index === lastIndex ? 1 : 0.42}
                    />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="coach-inline-chart-table-wrap coach-view-enter">
          <table className="coach-inline-chart-table">
            <caption className="sr-only">{chart.title}</caption>
            <thead>
              <tr><th>Period</th><th>Value</th></tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{formatChartValue(row.value, chart.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
