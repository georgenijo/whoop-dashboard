import { smoothPath } from "@/lib/paths";
import type { RecoveryRow } from "@/lib/db";

type Props = {
  rows: RecoveryRow[];
};

function pickAxis(rows: RecoveryRow[]): string[] {
  if (rows.length === 0) return [];
  const idx = [0, Math.floor(rows.length / 4), Math.floor(rows.length / 2), Math.floor((rows.length * 3) / 4), rows.length - 1];
  return Array.from(new Set(idx)).map((i) => {
    const d = new Date(rows[i].date + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });
}

export default function RecoveryTrend({ rows }: Props) {
  const values = rows
    .map((r) => r.recovery_score)
    .filter((v): v is number => v != null && Number.isFinite(v));

  if (values.length < 2) {
    return (
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              Recovery trend
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>30 days</div>
          </div>
        </div>
        <div className="empty-state">
          <div className="title">Not enough recovery data yet</div>
          <div className="sub">Connect Whoop and sync to see the 30-day trend</div>
        </div>
      </div>
    );
  }

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const latest = values[values.length - 1];
  const points = values.map<[number, number]>((v, i) => [
    (i / (values.length - 1)) * 100,
    100 - v,
  ]);
  const linePath = smoothPath(points);
  const areaPath = `${linePath} L 100,100 L 0,100 Z`;
  const endY = 100 - latest;
  const axis = pickAxis(rows);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            Recovery trend
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            {values.length} days · avg {avg.toFixed(0)}%
          </div>
        </div>
        <span className="card-sub">
          Today&nbsp;<span className="recovery-value">{latest.toFixed(0)}%</span>
        </span>
      </div>
      <div className="chart-body">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="rec-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--d-recovery)" stopOpacity="0.20" />
              <stop offset="100%" stopColor="var(--d-recovery)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#rec-area)" />
          <path d={linePath} fill="none" stroke="var(--d-recovery)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <circle
            cx="100"
            cy={endY}
            r="1.2"
            fill="var(--d-recovery)"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div className="chart-axis">
        {axis.map((label, i) => (
          <span key={`${label}-${i}`}>{label}</span>
        ))}
      </div>
    </div>
  );
}
