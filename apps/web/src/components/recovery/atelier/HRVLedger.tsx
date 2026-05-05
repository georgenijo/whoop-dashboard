import { smoothPath, sparklinePoints } from "@/lib/paths";
import { pickAxisLabels } from "@/lib/atelier-format";
import type { RecoveryRow } from "@/lib/db";

type Props = { rows: RecoveryRow[] };

export default function HRVLedger({ rows }: Props) {
  const values = rows.map((r) => r.hrv).filter((v): v is number => v != null);
  const axisLabels = pickAxisLabels(rows);

  if (values.length < 2) {
    return (
      <div className="atelier-recovery-chart-block">
        <div className="atelier-plate-head">
          <span className="atelier-plate-fig">FIG. 03 / HV-30</span>
        </div>
        <p className="atelier-chart-empty">Not enough HRV data</p>
      </div>
    );
  }

  const pts = sparklinePoints(values, 100, 100);
  const line = smoothPath(pts);

  return (
    <div className="atelier-recovery-chart-block">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">FIG. 03 / HV-30</span>
        <span className="atelier-plate-page">30-day HRV</span>
      </div>
      <p className="atelier-recovery-chart-title">
        HRV, the <em>vagal</em> ledger.
      </p>
      <div className="atelier-chart-body">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="hrv-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6e7448" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#6e7448" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d={`${line} L ${pts[pts.length - 1][0]},100 L ${pts[0][0]},100 Z`}
            fill="url(#hrv-area-grad)"
          />
          <path
            d={line}
            fill="none"
            stroke="var(--olive)"
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
