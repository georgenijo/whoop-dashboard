import { smoothPath } from "@/lib/paths";
import { pickAxisLabels } from "@/lib/atelier-format";
import type { CycleRow } from "@/lib/db";

type Props = { rows: CycleRow[] };

export default function KcalTrend({ rows }: Props) {
  const vals = rows.map((r) => (r.kilojoule != null ? r.kilojoule / 4.184 : null));
  const filtered = vals.filter((v): v is number => v != null);
  const axisLabels = pickAxisLabels(rows, 3);

  const minV = filtered.length ? Math.min(...filtered) : 0;
  const maxV = filtered.length ? Math.max(...filtered) : 1;
  const rangeV = maxV - minV || 1;
  const W = 100;
  const H = 100;
  const n = rows.length > 1 ? rows.length - 1 : 1;

  const points: [number, number][] = vals
    .map((v, i) =>
      v != null
        ? ([(i / n) * W, H - ((v - minV) / rangeV) * H] as [number, number])
        : null
    )
    .filter((p): p is [number, number] => p != null);

  const linePath = smoothPath(points);

  return (
    <div className="atelier-mini-panel">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">Plate N&#xba; 04 / FIG. KCAL-30</span>
        <span className="atelier-plate-page">kcal</span>
      </div>
      {filtered.length < 2 ? (
        <p className="atelier-chart-empty">Not enough data</p>
      ) : (
        <>
          <div className="atelier-chart-body">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              {points.length > 1 && (
                <path
                  d={linePath}
                  fill="none"
                  stroke="var(--mustard)"
                  strokeWidth="1.5"
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
        </>
      )}
    </div>
  );
}
