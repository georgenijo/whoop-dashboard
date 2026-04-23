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
              <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
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
            <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
            Recovery trend
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            {values.length} days · avg {avg.toFixed(0)}%
          </div>
        </div>
        <span className="card-sub">
          Today&nbsp;<span style={{ color: "#00d4aa" }}>{latest.toFixed(0)}%</span>
        </span>
      </div>
      <div className="chart-body">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="rec-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00d4aa" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#00d4aa" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="rec-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#00aa88" />
              <stop offset="100%" stopColor="#00d4aa" />
            </linearGradient>
          </defs>
          <line x1="0" y1="34" x2="100" y2="34" stroke="rgba(255,255,255,0.04)" strokeDasharray="0.3 0.6" strokeWidth="0.2" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1="67" x2="100" y2="67" stroke="rgba(255,255,255,0.04)" strokeDasharray="0.3 0.6" strokeWidth="0.2" vectorEffect="non-scaling-stroke" />
          <path d={areaPath} fill="url(#rec-area)" />
          <path d={linePath} fill="none" stroke="url(#rec-line)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <circle
            cx="100"
            cy={endY}
            r="1.2"
            fill="#00d4aa"
            vectorEffect="non-scaling-stroke"
            style={{ filter: "drop-shadow(0 0 3px #00d4aa)" }}
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
