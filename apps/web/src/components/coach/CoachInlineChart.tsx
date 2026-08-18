"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CoachChartSpec } from "@/lib/coach/visualization";

function formatValue(value: number, unit: string): string {
  return unit ? `${value.toLocaleString()} ${unit}` : value.toLocaleString();
}

function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: { value?: number }[];
  label?: string;
  unit: string;
}) {
  const value = payload?.[0]?.value;
  if (!active || typeof value !== "number") return null;
  return (
    <div className="coach-inline-chart-tooltip">
      <span>{label}</span>
      <strong>{formatValue(value, unit)}</strong>
    </div>
  );
}

export default function CoachInlineChart({ chart }: { chart: CoachChartSpec }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const data = chart.labels.map((label, index) => ({
    label,
    value: chart.values[index],
  }));
  const domain: [number | "auto", number | "auto"] = [
    chart.yMin ?? "auto",
    chart.yMax ?? "auto",
  ];

  return (
    <section className="coach-inline-chart" aria-label={chart.title}>
      <div className="coach-inline-chart-head">
        <div>
          <h3>{chart.title}</h3>
          <span>{chart.type === "line" ? "Trend" : "Comparison"}{chart.unit ? ` · ${chart.unit}` : ""}</span>
        </div>
        <div className="coach-inline-chart-switch" role="group" aria-label="Visualization view">
          <button
            type="button"
            className={view === "chart" ? "active" : ""}
            aria-pressed={view === "chart"}
            onClick={() => setView("chart")}
          >
            Chart
          </button>
          <button
            type="button"
            className={view === "table" ? "active" : ""}
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
          >
            Table
          </button>
        </div>
      </div>

      {view === "chart" ? (
        <div className="coach-inline-chart-plot" role="img" aria-label={`${chart.title} chart`}>
          <ResponsiveContainer width="100%" height="100%">
            {chart.type === "line" ? (
              <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="var(--rule-soft)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={20} tick={{ fill: "var(--fg-3)", fontSize: 10 }} />
                <YAxis domain={domain} tickLine={false} axisLine={false} width={48} tick={{ fill: "var(--fg-3)", fontSize: 10 }} />
                <Tooltip content={<ChartTooltip unit={chart.unit} />} cursor={{ stroke: "var(--fg-3)", strokeOpacity: 0.35 }} />
                <Line type="monotone" dataKey="value" stroke="var(--d-hrv)" strokeWidth={2} dot={{ r: 2.5, fill: "var(--bg)", strokeWidth: 2 }} activeDot={{ r: 4 }} isAnimationActive={false} />
              </LineChart>
            ) : (
              <BarChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="var(--rule-soft)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={20} tick={{ fill: "var(--fg-3)", fontSize: 10 }} />
                <YAxis domain={domain} tickLine={false} axisLine={false} width={48} tick={{ fill: "var(--fg-3)", fontSize: 10 }} />
                <Tooltip content={<ChartTooltip unit={chart.unit} />} cursor={{ fill: "var(--bg-lift)" }} />
                <Bar dataKey="value" fill="var(--d-hrv)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="coach-inline-chart-table-wrap">
          <table className="coach-inline-chart-table">
            <caption className="sr-only">{chart.title}</caption>
            <thead>
              <tr><th>Period</th><th>Value</th></tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{formatValue(row.value, chart.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
