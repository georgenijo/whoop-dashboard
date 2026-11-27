"use client";

import { type CSSProperties, memo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type {
  CoachPresentationBlock,
  ComparisonBlock,
  MetricStripBlock,
} from "@/lib/coach/presentation";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { type MetricAccent, accentVar, baselinePosition, metricAccent } from "@/lib/motion";
import { formatBlockNumber as number } from "./CoachChartParts";

// Recharts is fetched only when a reply carries a chart block; metrics,
// comparisons and plans render without it.
const RichChart = dynamic(() => import("./CoachRichChart"), {
  loading: () => <div className="coach-inline-chart is-loading" aria-busy="true" />,
});


/** Recovery reads in Whoop's own zones; everything else in its data color. */
function metricColor(accent: MetricAccent, value: number | null, unit: string): string {
  if (accent === "recovery" && unit === "%" && value !== null) {
    if (value >= 67) return "var(--ok)";
    if (value >= 34) return "var(--warn)";
    return "var(--bad)";
  }
  return accentVar(accent);
}

/**
 * The bar under each value. With a baseline it is a centred scale (the tick is
 * the baseline, the fill runs from it to today). A bare percentage fills to its
 * value. Anything else gets an empty track so the cards' rows stay aligned.
 */
function MetricMeter({ value, unit, baseline }: { value: number | null; unit: string; baseline: number | null }) {
  const position = baselinePosition(value, baseline);
  if (position !== null) {
    const start = Math.min(position, 0.5);
    const width = Math.abs(position - 0.5);
    return (
      <span className="coach-rich-metric-meter is-baseline" aria-hidden="true">
        <span className="coach-rich-metric-meter-fill" style={{ left: `${start * 100}%`, width: `${width * 100}%`, "--meter-origin": position >= 0.5 ? "left" : "right" } as CSSProperties} />
        <span className="coach-rich-metric-meter-tick" />
        <span className="coach-rich-metric-meter-marker" style={{ left: `${position * 100}%` }} />
      </span>
    );
  }
  if (unit === "%" && value !== null && value >= 0 && value <= 100) {
    return (
      <span className="coach-rich-metric-meter" aria-hidden="true">
        <span className="coach-rich-metric-meter-fill" style={{ left: 0, width: `${value}%` }} />
      </span>
    );
  }
  return <span className="coach-rich-metric-meter is-empty" aria-hidden="true" />;
}

function MetricCards({ metrics, comparison, columns }: { metrics: MetricStripBlock["metrics"]; comparison?: ComparisonBlock; columns?: 1 | 2 | 3 }) {
  return (
    <div className="coach-rich-metrics" style={{ gridTemplateColumns: `repeat(${columns ?? Math.min(metrics.length, 3)}, minmax(0, 1fr))` }}>
      {metrics.map((metric, index) => {
        const matches = metric.value === null ? [] : comparison?.items.filter((item) =>
          item.label === metric.label && item.unit === metric.unit && item.current === metric.value,
        ) ?? [];
        const match = matches.length === 1 ? matches[0] : undefined;
        const baseline = match?.baseline != null ? match : undefined;
        const accent = metricAccent(metric.label, metric.unit);
        const color = metricColor(accent, metric.value, metric.unit);
        const direction = baseline
          ? comparisonChange(baseline)
          : metric.value === null || metric.direction === "neutral"
            ? null
            : metric.direction === "up" ? "↑ Higher" : "↓ Lower";
        return (
        <div
          className={`coach-rich-metric tone-${metric.tone}`}
          key={metric.label}
          style={{ "--metric-accent": color, "--stagger": index } as CSSProperties}
        >
          <span className="coach-rich-metric-label">{metric.label}</span>
          <strong className="coach-rich-metric-value">
            {metric.value === null ? <><span aria-hidden="true">—</span><span className="sr-only">Not available</span></> : <AnimatedNumber value={metric.display_value} delay={index * 70} />}
            {metric.value !== null && metric.unit && !metric.display_value.toLowerCase().includes(metric.unit.toLowerCase()) ? <small>{metric.unit}</small> : null}
          </strong>
          <MetricMeter value={metric.value} unit={metric.unit} baseline={baseline?.baseline ?? null} />
          <span className="coach-rich-metric-direction">
            {direction}
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

function changeClass(item: ComparisonBlock["items"][number]): string {
  if (item.current === null || item.baseline === null || item.current === item.baseline) return "is-flat";
  return item.current > item.baseline ? "is-up" : "is-down";
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
            <tr key={item.label} style={{ "--metric-accent": accentVar(metricAccent(item.label, item.unit)) } as CSSProperties}>
              <th scope="row">{item.label}</th>
              <td>{number(item.current, item.unit)}</td>
              <td>{number(item.baseline, item.unit)}</td>
              <td><span className={`coach-rich-change ${changeClass(item)}`}>{comparisonChange(item)}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {block.items.some((item) => item.unit === "%") ? <p className="coach-rich-table-note">Changes in percentages are shown in percentage points.</p> : null}
    </details>
  );
}

/** Distinct colors per series: its own metric color, unless an earlier series already took it. */
function SyncButton() {
  const [syncState, setSyncState] = useState<"idle" | "running" | "done" | "error">("idle");
  return (
    <button
      type="button"
      className={`coach-rich-sync is-${syncState}`}
      disabled={syncState === "running"}
      onClick={async () => {
        setSyncState("running");
        try {
          const response = await fetch("/api/sync", { method: "POST" });
          setSyncState(response.ok ? "done" : "error");
        } catch {
          setSyncState("error");
        }
      }}
    >
      {syncState === "running" ? "Syncing…" : syncState === "done" ? "Sync requested" : "Sync now"}
    </button>
  );
}

function RichBlock({ block, comparison }: { block: CoachPresentationBlock; comparison?: ComparisonBlock }) {
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
        <><h3>Data freshness</h3>{block.sources.map((source) => <div className={`coach-rich-freshness status-${source.status.toLowerCase().replace(/[^a-z]+/g, "-")}`} key={source.source}><span>{source.source}</span><strong>{source.status}</strong><small>{source.last_available_date ?? "No data"}</small></div>)}{block.sync_available ? <SyncButton /> : null}</>
      ) : block.type === "workout_plan" ? (
        <><h3>{block.title}</h3>{block.date ? <p>{block.date}</p> : null}<ol>{block.exercises.map((exercise) => <li key={`${exercise.name}:${exercise.prescription}`}><strong>{exercise.name}</strong> — {exercise.prescription}{exercise.notes ? <small>{exercise.notes}</small> : null}</li>)}</ol><Link href="/plans">Open Plans</Link></>
      ) : (
        <details><summary>{block.title}</summary><p>{block.date_range} · {block.record_count} records · {block.missing_days} missing days</p><p>Sources: {block.sources.join(", ")}</p><ul>{block.points.map((point) => <li key={point}>{point}</li>)}</ul></details>
      )}
    </section>
  );
}

function CoachPresentationBlocks({ blocks }: { blocks: CoachPresentationBlock[] }) {
  if (blocks.length === 0) return null;
  const comparisons = blocks.filter((block) => block.type === "comparison");
  const comparison = comparisons.length === 1 ? comparisons[0] : undefined;
  return (
    <div className="coach-rich-blocks">
      {blocks.map((block, index) => (
        <div className="coach-rich-enter" style={{ "--stagger": index } as CSSProperties} key={`${block.type}:${index}`}>
          <RichBlock block={block} comparison={comparison} />
        </div>
      ))}
    </div>
  );
}

// Every bubble re-renders per streamed token; finished messages keep the same
// `blocks` array, so a shallow memo stops their charts re-animating each time.
export default memo(CoachPresentationBlocks);
