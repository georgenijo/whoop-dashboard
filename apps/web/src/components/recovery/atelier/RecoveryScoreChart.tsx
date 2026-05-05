import { smoothPath, sparklinePoints } from "@/lib/paths";
import { pickAxisLabels } from "@/lib/atelier-format";
import type { RecoveryRow } from "@/lib/db";

type Props = { rows: RecoveryRow[] };

export default function RecoveryScoreChart({ rows }: Props) {
  const values = rows.map((r) => r.recovery_score).filter((v): v is number => v != null);
  const axisLabels = pickAxisLabels(rows);

  if (values.length < 2) {
    return (
      <div className="atelier-recovery-chart-block">
        <div className="atelier-plate-head">
          <span className="atelier-plate-fig">FIG. 02 / RC-30</span>
        </div>
        <p className="atelier-chart-empty">Not enough recovery data</p>
      </div>
    );
  }

  const pts = sparklinePoints(values, 100, 100);
  const line = smoothPath(pts);

  return (
    <div className="atelier-recovery-chart-block">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">FIG. 02 / RC-30</span>
        <span className="atelier-plate-page">30-day recovery</span>
      </div>
      <p className="atelier-recovery-chart-title">
        Recovery score, the <em>morning verdict.</em>
      </p>
      <div className="atelier-chart-body">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="rc-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ed6f5c" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#ed6f5c" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* zone hairlines at 33% and 67% */}
          <line x1="0" y1="33" x2="100" y2="33" stroke="var(--line-soft)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1="67" x2="100" y2="67" stroke="var(--line-soft)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
          <path
            d={`${line} L ${pts[pts.length - 1][0]},100 L ${pts[0][0]},100 Z`}
            fill="url(#rc-area-grad)"
          />
          <path
            d={line}
            fill="none"
            stroke="#ed6f5c"
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
