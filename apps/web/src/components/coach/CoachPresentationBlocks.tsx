"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  Bar,
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
import type {
  ChartBlock,
  CoachPresentationBlock,
  ComparisonBlock,
  MetricStripBlock,
} from "@/lib/coach/presentation";

function number(value: number | null, unit = ""): string {
  if (value === null) return "Not available";
  return `${value.toLocaleString("en-US")}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`;
}

function MetricCards({ metrics, comparison, columns }: { metrics: MetricStripBlock["metrics"]; comparison?: ComparisonBlock; columns?: 1 | 2 | 3 }) {
  return (
    <div className="coach-rich-metrics" style={{ gridTemplateColumns: `repeat(${columns ?? Math.min(metrics.length, 3)}, minmax(0, 1fr))` }}>
      {metrics.map((metric) => {
        const matches = metric.value === null ? [] : comparison?.items.filter((item) =>
          item.label === metric.label && item.unit === metric.unit && item.current === metric.value,
        ) ?? [];
        const match = matches.length === 1 ? matches[0] : undefined;
        const baseline = match?.baseline != null ? match : undefined;
        return (
        <div className={`coach-rich-metric tone-${metric.tone}`} key={metric.label}>
          <span className="coach-rich-metric-label">{metric.label}</span>
          <strong className="coach-rich-metric-value">
            {metric.value === null ? <><span aria-hidden="true">—</span><span className="sr-only">Not available</span></> : metric.display_value}
            {metric.value !== null && metric.unit && !metric.display_value.toLowerCase().includes(metric.unit.toLowerCase()) ? <small>{metric.unit}</small> : null}
          </strong>
          <span className="coach-rich-metric-direction">
            {baseline ? comparisonChange(baseline) : metric.value === null || metric.direction === "neutral" ? null : metric.direction === "up" ? "↑ Higher" : "↓ Lower"}
          </span>
          <span className="coach-rich-metric-baseline">{baseline && baseline.baseline !== null ? `Baseline ${number(baseline.baseline, baseline.unit)}` : null}</span>
        </div>
        );
      })}
    </div>
  );
}

function comparisonChange(item: ComparisonBlock["items"][number]): string {
  if (item.current === null || item.baseline === null) return "Not available";
  const delta = item.current - item.baseline;
  if (!Number.isFinite(delta)) return "Not available";
  if (delta === 0) return "Unchanged";
  const magnitude = Math.abs(delta);
  const unit = item.unit === "%" ? (magnitude === 1 ? "pt" : "pts") : item.unit;
  const change = magnitude < 0.01 ? `<${number(0.01, unit)}` : number(Number(magnitude.toFixed(2)), unit);
  return `${delta > 0 ? "↑" : "↓"} ${change}`;
}

function Comparison({ block }: { block: ComparisonBlock }) {
  return (
    <details className="coach-rich-details coach-rich-comparison">
      <summary><ChevronRight size={16} aria-hidden="true" /><span>{block.title}</span><small>{block.items.length} {block.items.length === 1 ? "metric" : "metrics"}</small></summary>
      <div className="coach-rich-table-wrap">
        <table className="coach-rich-table">
          <caption className="sr-only">{block.title}</caption>
          <thead><tr><th scope="col">Metric</th><th scope="col">Current</th><th scope="col">Baseline</th><th scope="col">Change</th></tr></thead>
          <tbody>{block.items.map((item) => (
            <tr key={item.label}><th scope="row">{item.label}</th><td>{number(item.current, item.unit)}</td><td>{number(item.baseline, item.unit)}</td><td>{comparisonChange(item)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      {block.items.some((item) => item.unit === "%") ? <p className="coach-rich-table-note">Changes in percentages are shown in percentage points.</p> : null}
    </details>
  );
}

function RichChart({ block }: { block: ChartBlock }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const rows = useMemo<Array<Record<string, string | number | null | undefined>>>(
    () => block.labels.map((label, index) => ({
      label,
      ...Object.fromEntries(block.series.map((series) => [series.id, series.values[index]])),
      anomaly: block.anomalies.find((item) => item.index === index)?.label,
    })),
    [block],
  );
  async function copyTable() {
    const header = ["Period", ...block.series.map((series) => `${series.label}${series.unit ? ` (${series.unit})` : ""}`), "Note"];
    const body = rows.map((row) => [row.label, ...block.series.map((series) => row[series.id] ?? ""), row.anomaly ?? ""]);
    await navigator.clipboard.writeText([header, ...body].map((row) => row.join("\t")).join("\n"));
  }
  return (
    <section className="coach-inline-chart" aria-label={block.title}>
      <div className="coach-inline-chart-head">
        <div><h3>{block.title}</h3><span>{block.labels.length} points · {block.series.length} series</span></div>
        <div className="coach-inline-chart-switch" role="group" aria-label="Visualization view">
          {(["chart", "table"] as const).map((mode) => (
            <button type="button" className={view === mode ? "active" : ""} aria-pressed={view === mode} onClick={() => setView(mode)} key={mode}>
              {mode === "chart" ? "Chart" : "Table"}
            </button>
          ))}
        </div>
      </div>
      {view === "chart" ? (
        <div className="coach-inline-chart-plot" role="img" aria-label={`${block.title}. ${block.fallback}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 10, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="var(--rule-soft)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={20} tick={{ fill: "var(--fg-3)", fontSize: 10 }} />
              <YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: "var(--fg-3)", fontSize: 10 }} />
              <Tooltip />
              <Legend />
              {block.references.map((reference) => <ReferenceLine y={reference.value} label={reference.label} stroke="var(--fg-3)" strokeDasharray="4 4" key={`${reference.label}:${reference.value}`} />)}
              {block.series.map((series, index) => series.kind === "bar" ? (
                <Bar dataKey={series.id} name={`${series.label}${series.unit ? ` (${series.unit})` : ""}`} fill={index % 2 ? "var(--d-strain)" : "var(--d-hrv)"} radius={[3, 3, 0, 0]} isAnimationActive={false} key={series.id} />
              ) : (
                <Line type="monotone" dataKey={series.id} name={`${series.label}${series.unit ? ` (${series.unit})` : ""}`} stroke={index % 2 ? "var(--d-strain)" : "var(--d-hrv)"} strokeWidth={2} connectNulls={false} isAnimationActive={false} key={series.id} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="coach-inline-chart-table-wrap">
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

function RichBlock({ block, comparison }: { block: CoachPresentationBlock; comparison?: ComparisonBlock }) {
  const [syncState, setSyncState] = useState<"idle" | "running" | "done" | "error">("idle");
  if (block.type === "chart") return <RichChart block={block} />;
  return (
    <section className={`coach-rich-block coach-rich-${block.type}`} aria-label={block.fallback}>
      {block.type === "metric_strip" ? (
        <>
          <MetricCards metrics={block.metrics.slice(0, 3)} comparison={comparison} />
          {block.metrics.length > 3 ? <details className="coach-rich-details coach-rich-extra-metrics"><summary><ChevronRight size={16} aria-hidden="true" /><span>View {block.metrics.length - 3} more {block.metrics.length === 4 ? "metric" : "metrics"}</span></summary><MetricCards metrics={block.metrics.slice(3)} comparison={comparison} columns={3} /></details> : null}
        </>
      ) : block.type === "comparison" ? (
        <Comparison block={block} />
      ) : block.type === "action_plan" ? (
        <><h3>{block.title}</h3><div className="coach-rich-plan">{block.sections.map((section) => <div key={section.timeframe}><h4>{section.timeframe}</h4><ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul></div>)}</div></>
      ) : block.type === "data_freshness" ? (
        <><h3>Data freshness</h3>{block.sources.map((source) => <div className="coach-rich-freshness" key={source.source}><span>{source.source}</span><strong>{source.status}</strong><small>{source.last_available_date ?? "No data"}</small></div>)}{block.sync_available ? <button type="button" disabled={syncState === "running"} onClick={async () => { setSyncState("running"); try { const response = await fetch("/api/sync", { method: "POST" }); setSyncState(response.ok ? "done" : "error"); } catch { setSyncState("error"); } }}>{syncState === "running" ? "Syncing…" : syncState === "done" ? "Sync requested" : "Sync now"}</button> : null}</>
      ) : block.type === "workout_plan" ? (
        <><h3>{block.title}</h3>{block.date ? <p>{block.date}</p> : null}<ol>{block.exercises.map((exercise) => <li key={`${exercise.name}:${exercise.prescription}`}><strong>{exercise.name}</strong> — {exercise.prescription}{exercise.notes ? <small>{exercise.notes}</small> : null}</li>)}</ol><Link href="/plans">Open Plans</Link></>
      ) : (
        <details><summary>{block.title}</summary><p>{block.date_range} · {block.record_count} records · {block.missing_days} missing days</p><p>Sources: {block.sources.join(", ")}</p><ul>{block.points.map((point) => <li key={point}>{point}</li>)}</ul></details>
      )}
    </section>
  );
}

export default function CoachPresentationBlocks({ blocks }: { blocks: CoachPresentationBlock[] }) {
  if (blocks.length === 0) return null;
  const comparisons = blocks.filter((block) => block.type === "comparison");
  const comparison = comparisons.length === 1 ? comparisons[0] : undefined;
  return <div className="coach-rich-blocks">{blocks.map((block, index) => <RichBlock block={block} comparison={comparison} key={`${block.type}:${index}`} />)}</div>;
}
