import { smoothPath, sparklinePoints } from "@/lib/paths";
import { pickAxisLabels } from "@/lib/atelier-format";
import type { RecoveryRow } from "@/lib/db";

type Props = { rows: RecoveryRow[] };

export default function AtelierHRVTrend({ rows }: Props) {
  const valid = rows.filter((r) => r.hrv != null && Number.isFinite(r.hrv));
  const values = valid.map((r) => r.hrv as number);
  const axisLabels = pickAxisLabels(valid);

  if (values.length < 2) {
    return (
      <div className="atelier-recovery-analytic">
        <div className="atelier-plate-head">
          <span className="atelier-plate-fig">FIG. 07 / HV-TREND</span>
        </div>
        <p className="atelier-chart-empty">Not enough HRV data</p>
      </div>
    );
  }

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const latest = values[values.length - 1];
  const min = Math.min(...values);
  const max = Math.max(...values);

  // Build 7-day rolling mean overlay
  const rolling7: (number | null)[] = values.map((_, i) => {
    const window = values.slice(Math.max(0, i - 6), i + 1);
    return window.reduce((a, b) => a + b, 0) / window.length;
  });

  const rawPts = sparklinePoints(values, 100, 100);
  const rawLine = smoothPath(rawPts);

  // Build rolling pts in same coordinate space (already normalized via sparkline)
  const rollingPts: [number, number][] = rolling7.map((v, i) => {
    if (v == null) return null as unknown as [number, number];
    return [
      (i / (values.length - 1)) * 100,
      100 - ((v - min) / (max - min || 1)) * 100,
    ];
  }).filter(Boolean) as [number, number][];
  const rollingLine = smoothPath(rollingPts);

  return (
    <div className="atelier-recovery-analytic">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">FIG. 07 / HV-TREND</span>
        <span className="atelier-plate-page">30-day HRV trend</span>
      </div>
      <p className="atelier-recovery-chart-title">
        HRV over time, <em>the autonomic record.</em>
      </p>
      <div className="atelier-hrv-kpi-row">
        <div className="atelier-hrv-kpi">
          <span className="atelier-hrv-kpi-label">Latest</span>
          <span className="atelier-hrv-kpi-value">{latest.toFixed(0)} <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>ms</span></span>
        </div>
        <div className="atelier-hrv-kpi">
          <span className="atelier-hrv-kpi-label">30d avg</span>
          <span className="atelier-hrv-kpi-value">{avg.toFixed(0)} <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>ms</span></span>
        </div>
        <div className="atelier-hrv-kpi">
          <span className="atelier-hrv-kpi-label">Range</span>
          <span className="atelier-hrv-kpi-value">{min.toFixed(0)}–{max.toFixed(0)}</span>
        </div>
      </div>
      <div className="atelier-chart-body">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="hrv-trend-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--olive)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--olive)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* raw area fill */}
          <path
            d={`${rawLine} L ${rawPts[rawPts.length - 1][0]},100 L ${rawPts[0][0]},100 Z`}
            fill="url(#hrv-trend-grad)"
          />
          {/* raw line — faint */}
          <path
            d={rawLine}
            fill="none"
            stroke="var(--olive)"
            strokeOpacity="0.35"
            strokeWidth="0.8"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* 7-day rolling overlay */}
          {rollingLine && (
            <path
              d={rollingLine}
              fill="none"
              stroke="var(--olive)"
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
      <div className="atelier-chart-axis">
        {axisLabels.map((lbl, i) => (
          <span key={`${lbl}-${i}`}>{lbl}</span>
        ))}
      </div>
      <div className="atelier-trend-legend">
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ display: "inline-block", width: 16, height: 1.5, background: "var(--olive)", opacity: 0.35 }} />
          raw
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ display: "inline-block", width: 16, height: 1.5, background: "var(--olive)" }} />
          7-day avg
        </span>
      </div>
    </div>
  );
}
