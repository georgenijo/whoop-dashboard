"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
} from "@/lib/coach/presentation";

function number(value: number | null, unit = ""): string {
  if (value === null) return "Not available";
  return `${value.toLocaleString()}${unit ? ` ${unit}` : ""}`;
}

function blockText(block: CoachPresentationBlock): string {
  return block.fallback;
}

function BlockActions({ block }: { block: CoachPresentationBlock }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(blockText(block));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }
  async function share() {
    if (navigator.share) await navigator.share({ title: "Coach summary", text: blockText(block) });
    else await copy();
  }
  return (
    <div className="coach-rich-actions">
      <button type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      <button type="button" onClick={share}>Share</button>
    </div>
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
      <BlockActions block={block} />
    </section>
  );
}

function RichBlock({ block }: { block: CoachPresentationBlock }) {
  const [syncState, setSyncState] = useState<"idle" | "running" | "done" | "error">("idle");
  if (block.type === "chart") return <RichChart block={block} />;
  return (
    <section className={`coach-rich-block coach-rich-${block.type}`} aria-label={block.fallback}>
      {block.type === "metric_strip" ? (
        <div className="coach-rich-metrics">{block.metrics.map((metric) => <div className={`coach-rich-metric tone-${metric.tone}`} key={metric.label}><span>{metric.label}</span><strong>{metric.display_value}</strong><small>{metric.unit}{metric.direction === "neutral" ? "" : ` · ${metric.direction === "up" ? "↑" : "↓"}`}</small></div>)}</div>
      ) : block.type === "comparison" ? (
        <><h3>{block.title}</h3><div className="coach-rich-comparison">{block.items.map((item) => <div key={item.label}><span>{item.label}</span><strong>{number(item.current, item.unit)}</strong><small>Baseline {number(item.baseline, item.unit)} · Δ {number(item.delta, item.unit)}</small></div>)}</div></>
      ) : block.type === "action_plan" ? (
        <><h3>{block.title}</h3><div className="coach-rich-plan">{block.sections.map((section) => <div key={section.timeframe}><h4>{section.timeframe}</h4><ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul></div>)}</div></>
      ) : block.type === "data_freshness" ? (
        <><h3>Data freshness</h3>{block.sources.map((source) => <div className="coach-rich-freshness" key={source.source}><span>{source.source}</span><strong>{source.status}</strong><small>{source.last_available_date ?? "No data"}</small></div>)}{block.sync_available ? <button type="button" disabled={syncState === "running"} onClick={async () => { setSyncState("running"); try { const response = await fetch("/api/sync", { method: "POST" }); setSyncState(response.ok ? "done" : "error"); } catch { setSyncState("error"); } }}>{syncState === "running" ? "Syncing…" : syncState === "done" ? "Sync requested" : "Sync now"}</button> : null}</>
      ) : block.type === "workout_plan" ? (
        <><h3>{block.title}</h3>{block.date ? <p>{block.date}</p> : null}<ol>{block.exercises.map((exercise) => <li key={`${exercise.name}:${exercise.prescription}`}><strong>{exercise.name}</strong> — {exercise.prescription}{exercise.notes ? <small>{exercise.notes}</small> : null}</li>)}</ol><Link href="/plans">Open Plans</Link></>
      ) : (
        <details><summary>{block.title}</summary><p>{block.date_range} · {block.record_count} records · {block.missing_days} missing days</p><p>Sources: {block.sources.join(", ")}</p><ul>{block.points.map((point) => <li key={point}>{point}</li>)}</ul></details>
      )}
      <BlockActions block={block} />
    </section>
  );
}

export default function CoachPresentationBlocks({ blocks }: { blocks: CoachPresentationBlock[] }) {
  if (blocks.length === 0) return null;
  return <div className="coach-rich-blocks">{blocks.map((block, index) => <RichBlock block={block} key={`${block.type}:${index}`} />)}</div>;
}
