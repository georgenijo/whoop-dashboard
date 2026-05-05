import { smoothPath, sparklinePoints } from "@/lib/paths";
import { pickAxisLabels } from "@/lib/atelier-format";
import type { RecoveryRow } from "@/lib/db";

type Props = { rows: RecoveryRow[] };

export default function RHRBaseline({ rows }: Props) {
  const values = rows.map((r) => r.rhr).filter((v): v is number => v != null);
  const axisLabels = pickAxisLabels(rows);

  if (values.length < 2) {
    return (
      <div className="atelier-recovery-chart-block">
        <div className="atelier-plate-head">
          <span className="atelier-plate-fig">FIG. 04 / RH-30</span>
        </div>
        <p className="atelier-chart-empty">Not enough RHR data</p>
      </div>
    );
  }

  const pts = sparklinePoints(values, 100, 100);
  const line = smoothPath(pts);

  return (
    <div className="atelier-recovery-chart-block">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">FIG. 04 / RH-30</span>
        <span className="atelier-plate-page">30-day RHR</span>
      </div>
      <p className="atelier-recovery-chart-title">
        Resting pulse, the <em>quiet</em> baseline.
      </p>
      <div className="atelier-chart-body">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="rhr-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e9b94a" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#e9b94a" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d={`${line} L ${pts[pts.length - 1][0]},100 L ${pts[0][0]},100 Z`}
            fill="url(#rhr-area-grad)"
          />
          <path
            d={line}
            fill="none"
            stroke="var(--mustard)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div className="atelier-chart-axis">
        {axisLabels.map((lbl, i) => (
          <span key={`${lbl}-${i}`}>{lbl}</span>
        ))}
      </div>
    </div>
  );
}
