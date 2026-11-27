"use client";

import { type CSSProperties, useId, useMemo, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartBlock } from "@/lib/coach/presentation";
import { usePrefersReducedMotion } from "@/components/motion/AnimatedNumber";
import { accentVar, metricAccent } from "@/lib/motion";
import {
  AreaGradient,
  ChartHeadline,
  CoachChartTooltip,
  ViewSwitch,
  formatBlockNumber as number,
  liveDot,
} from "./CoachChartParts";
import { lastNumericIndex, summarizeSeries, svgSafeId } from "./chartSummary";

// Split out of CoachPresentationBlocks so Recharts loads lazily (#593).

function seriesColors(series: ChartBlock["series"]): string[] {
  const fallback = ["var(--d-hrv)", "var(--d-strain)", "var(--d-sleep)", "var(--d-recovery)"];
  const used = new Set<string>();
  return series.map((item, index) => {
    let color = accentVar(metricAccent(item.label, item.unit));
    if (color === accentVar("neutral") || used.has(color)) {
      color = fallback.find((candidate) => !used.has(candidate)) ?? fallback[index % fallback.length];
    }
    used.add(color);
    return color;
  });
}

export default function RichChart({ block }: { block: ChartBlock }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const reduced = usePrefersReducedMotion();
  const idBase = `coach-rich-${svgSafeId(useId())}`;
  const colors = useMemo(() => seriesColors(block.series), [block.series]);
  const rows = useMemo<Array<Record<string, string | number | null | undefined>>>(
    () => block.labels.map((label, index) => ({
      label,
      ...Object.fromEntries(block.series.map((series) => [series.id, series.values[index]])),
      anomaly: block.anomalies.find((item) => item.index === index)?.label,
    })),
    [block],
  );
  const lead = block.series[0];
  // Headline the lead series only when it is a trend line; bars compare
  // categories, where "latest" and "change" would be a false trend claim.
  const summary = useMemo(() => (lead?.kind === "line" ? summarizeSeries(lead.values, lead.unit) : null), [lead]);
  const units = Object.fromEntries(block.series.map((series) => [series.id, series.unit]));
  const dots = useMemo(
    () => block.series.map((series, index) => liveDot(lastNumericIndex(series.values), colors[index])),
    [block.series, colors],
  );
  const motion = { isAnimationActive: !reduced, animationDuration: 900, animationEasing: "ease-out" as const };
  async function copyTable() {
    const header = ["Period", ...block.series.map((series) => `${series.label}${series.unit ? ` (${series.unit})` : ""}`), "Note"];
    const body = rows.map((row) => [row.label, ...block.series.map((series) => row[series.id] ?? ""), row.anomaly ?? ""]);
    await navigator.clipboard.writeText([header, ...body].map((row) => row.join("\t")).join("\n"));
  }
  return (
    <section className="coach-inline-chart" aria-label={block.title} style={{ "--metric-accent": colors[0] } as CSSProperties}>
      <div className="coach-inline-chart-head">
        <div className="coach-inline-chart-title"><h3>{block.title}</h3><span>{block.labels.length} points · {block.series.length} series</span></div>
        <ViewSwitch view={view} onChange={setView} />
      </div>
      <ChartHeadline summary={summary} color={colors[0]} label={block.series.length > 1 ? lead?.label : undefined} />
      {view === "chart" ? (
        <div className="coach-inline-chart-plot coach-view-enter" role="img" aria-label={`${block.title}. ${block.fallback}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 12, right: 12, bottom: 0, left: -12 }}>
              <defs>
                {block.series.map((series, index) => <AreaGradient id={`${idBase}-${index}`} color={colors[index]} key={series.id} />)}
              </defs>
              <CartesianGrid stroke="var(--rule-soft)" strokeDasharray="2 5" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-num)" }} />
              <YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-num)" }} />
              <Tooltip content={<CoachChartTooltip units={units} />} cursor={{ stroke: "var(--fg-3)", strokeOpacity: 0.4, strokeDasharray: "3 3" }} />
              {block.series.length > 1 ? <Legend iconType="circle" iconSize={7} /> : null}
              {block.references.map((reference) => (
                <ReferenceLine
                  y={reference.value}
                  label={{ value: reference.label, position: "insideTopRight", fill: "var(--fg-3)", fontSize: 10 }}
                  stroke="var(--fg-3)"
                  strokeOpacity={0.6}
                  strokeDasharray="4 4"
                  key={`${reference.label}:${reference.value}`}
                />
              ))}
              {block.series.map((series, index) => series.kind === "bar" ? (
                <Bar dataKey={series.id} name={`${series.label}${series.unit ? ` (${series.unit})` : ""}`} fill={colors[index]} fillOpacity={0.78} radius={[6, 6, 2, 2]} maxBarSize={40} {...motion} key={series.id} />
              ) : (
                <Area
                  type="monotone"
                  dataKey={series.id}
                  name={`${series.label}${series.unit ? ` (${series.unit})` : ""}`}
                  stroke={colors[index]}
                  strokeWidth={2.25}
                  fill={`url(#${idBase}-${index})`}
                  connectNulls={false}
                  dot={dots[index]}
                  activeDot={{ r: 5, fill: colors[index], stroke: "var(--bg-sunk)", strokeWidth: 2 }}
                  {...motion}
                  key={series.id}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="coach-inline-chart-table-wrap coach-view-enter">
          <table className="coach-inline-chart-table">
            <caption className="sr-only">{block.title}</caption>
            <thead><tr><th>Period</th>{block.series.map((series) => <th key={series.id}>{series.label}</th>)}<th>Note</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={String(row.label)}><td>{row.label}</td>{block.series.map((series) => <td key={series.id}>{number(row[series.id] as number | null, series.unit)}</td>)}<td>{row.anomaly ?? ""}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <div className="coach-rich-chart-actions"><button type="button" onClick={copyTable}>Copy table</button></div>
    </section>
  );
}

