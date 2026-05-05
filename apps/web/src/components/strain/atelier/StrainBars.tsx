import type { CycleRow } from "@/lib/db";

type Props = { rows: CycleRow[] };

const PANEL_H = 100;
const BAR_W = 6;
const BAR_GAP = 2;

export default function StrainBars({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="atelier-strain-bars-plate">
        <div className="atelier-plate-head">
          <span className="atelier-plate-fig">Plate N&#xba; 02 / FIG. 30-D-STRAIN</span>
        </div>
        <p className="atelier-chart-empty">No strain data</p>
      </div>
    );
  }

  const strainVals = rows.map((r) => r.strain ?? 0);
  const avg = strainVals.reduce((a, b) => a + b, 0) / strainVals.length;
  const avgY = PANEL_H - (avg / 21) * PANEL_H;

  const totalW = rows.length * (BAR_W + BAR_GAP) - BAR_GAP;

  const fmtDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const labelIndices = [0, 6, 13, 20, rows.length - 1].filter(
    (i) => i < rows.length
  );

  return (
    <div className="atelier-strain-bars-plate">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">Plate N&#xba; 02 / FIG. 30-D-STRAIN</span>
        <span className="atelier-plate-page">30-day window</span>
      </div>
      <div className="atelier-strain-bars-body">
        <svg
          viewBox={`0 0 ${totalW} ${PANEL_H}`}
          preserveAspectRatio="none"
          aria-hidden
          style={{ width: "100%", height: "120px", display: "block" }}
        >
          {rows.map((row, i) => {
            const barH = ((row.strain ?? 0) / 21) * PANEL_H;
            const x = i * (BAR_W + BAR_GAP);
            const y = PANEL_H - barH;
            return (
              <rect
                key={row.date}
                x={x}
                y={y}
                width={BAR_W}
                height={barH}
                fill="#ed6f5c"
                opacity={0.85}
              />
            );
          })}
          <line
            x1={0}
            y1={avgY}
            x2={totalW}
            y2={avgY}
            stroke="var(--ink-faint)"
            strokeWidth="0.8"
            strokeDasharray="2 4"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="atelier-strain-bars-axis">
          {rows.map((row, i) =>
            labelIndices.includes(i) ? (
              <span key={row.date} style={{ flexShrink: 0 }}>
                {fmtDate(row.date)}
              </span>
            ) : null
          )}
        </div>
      </div>
    </div>
  );
}
