import { headers } from "next/headers";
import { requireAuthOrSignin } from "@/lib/auth";
import {
  getPerfDaily,
  getPerfSummary,
  recentPerfMetrics,
  PERF_METRICS,
  type PerfMetricName,
} from "@/lib/db/perf";
import PerfCharts, { type PerfChartSeries } from "./PerfCharts";

export const dynamic = "force-dynamic";

type MetricMeta = {
  unit: "ms" | "";
  good: number;
  poor: number;
  desc: string;
};

// Google Web Vitals thresholds (p75 good / poor boundaries).
const META: Record<PerfMetricName, MetricMeta> = {
  LCP: { unit: "ms", good: 2500, poor: 4000, desc: "Largest Contentful Paint" },
  INP: { unit: "ms", good: 200, poor: 500, desc: "Interaction to Next Paint" },
  CLS: { unit: "", good: 0.1, poor: 0.25, desc: "Cumulative Layout Shift" },
  FCP: { unit: "ms", good: 1800, poor: 3000, desc: "First Contentful Paint" },
  TTFB: { unit: "ms", good: 800, poor: 1800, desc: "Time to First Byte" },
  FID: { unit: "ms", good: 100, poor: 300, desc: "First Input Delay" },
};

const RATING_COLOR = {
  good: "#00d4aa",
  "needs-improvement": "#ffaa00",
  poor: "#ff6b6b",
} as const;

function ratingOf(metric: PerfMetricName, value: number): keyof typeof RATING_COLOR {
  const m = META[metric];
  if (value <= m.good) return "good";
  if (value > m.poor) return "poor";
  return "needs-improvement";
}

function formatValue(metric: PerfMetricName, value: number): string {
  if (META[metric].unit === "") return value.toFixed(3);
  if (value >= 1000) return `${(value / 1000).toFixed(2)}`;
  return `${Math.round(value)}`;
}

function valueUnit(metric: PerfMetricName, value: number): string {
  if (META[metric].unit === "") return "";
  return value >= 1000 ? "s" : "ms";
}

export default async function PerfPage() {
  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );

  const summary = getPerfSummary(user.id, 30);
  const summaryByMetric = new Map(summary.map((s) => [s.metric, s]));
  const recent = recentPerfMetrics(user.id, 50);

  const charts: PerfChartSeries[] = [];
  for (const metric of PERF_METRICS) {
    const s = summaryByMetric.get(metric);
    if (!s) continue;
    const points = getPerfDaily(user.id, metric, 30);
    if (points.length === 0) continue;
    charts.push({
      metric,
      unit: META[metric].unit,
      color: RATING_COLOR[ratingOf(metric, s.p75)],
      goodThreshold: META[metric].good,
      points: points.map((p) => ({ day: p.day.slice(5), p75: Number(p.p75.toFixed(META[metric].unit === "" ? 3 : 0)) })),
    });
  }

  const hasData = summary.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <p style={{ color: "var(--fg-3)", fontSize: 13, margin: 0 }}>
        Core Web Vitals collected from your browser as you use the dashboard.
        p75 over the last 30 days · lower is better.
      </p>

      {!hasData ? (
        <div className="card">
          <div className="card-head">
            <div className="card-title">No samples yet</div>
          </div>
          <p style={{ color: "var(--fg-3)", fontSize: 13, margin: 0 }}>
            Web Vitals are recorded on page loads and interactions. Browse a few
            pages, then refresh this one to see data.
          </p>
        </div>
      ) : (
        <>
          <div
            className="kpi-strip"
            aria-label="Web Vitals (p75)"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
          >
            {PERF_METRICS.map((metric) => {
              const s = summaryByMetric.get(metric);
              if (!s) return null;
              const rating = ratingOf(metric, s.p75);
              const color = RATING_COLOR[rating];
              return (
                <div key={metric} className="kpi" style={{ cursor: "default" }}>
                  <div className="head">
                    <span className="lbl">
                      {metric}
                      <span style={{ color: "var(--fg-3)", fontWeight: 400 }}>
                        {" "}
                        p75
                      </span>
                    </span>
                    <span className="dot" style={{ background: color, color }} />
                  </div>
                  <div className="val">
                    {formatValue(metric, s.p75)}
                    <span className="unit">{valueUnit(metric, s.p75)}</span>
                  </div>
                  <div className="delta flat" style={{ color }}>
                    {rating.replace("-", " ")} · {s.count} samples
                  </div>
                </div>
              );
            })}
          </div>

          <PerfCharts charts={charts} />

          <div className="card">
            <div className="card-head">
              <div className="card-title">Recent samples</div>
              <div className="card-sub">latest {recent.length}</div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ color: "var(--fg-3)", textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>Time</th>
                    <th style={{ padding: "6px 8px" }}>Metric</th>
                    <th style={{ padding: "6px 8px" }}>Value</th>
                    <th style={{ padding: "6px 8px" }}>Rating</th>
                    <th style={{ padding: "6px 8px" }}>Path</th>
                  </tr>
                </thead>
                <tbody style={{ fontFamily: "var(--font-mono)" }}>
                  {recent.map((r) => {
                    const m = r.metric as PerfMetricName;
                    const known = m in META;
                    const color =
                      r.rating && r.rating in RATING_COLOR
                        ? RATING_COLOR[r.rating as keyof typeof RATING_COLOR]
                        : "var(--fg-3)";
                    return (
                      <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                        <td style={{ padding: "6px 8px", color: "var(--fg-3)" }}>
                          {r.created_at.slice(5, 16).replace("T", " ")}
                        </td>
                        <td style={{ padding: "6px 8px" }}>{r.metric}</td>
                        <td style={{ padding: "6px 8px" }}>
                          {known ? formatValue(m, r.value) + valueUnit(m, r.value) : r.value}
                        </td>
                        <td style={{ padding: "6px 8px", color }}>
                          {r.rating ?? "—"}
                        </td>
                        <td style={{ padding: "6px 8px", color: "var(--fg-3)" }}>
                          {r.path ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
