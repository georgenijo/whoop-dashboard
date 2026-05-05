import type { WorkoutRow } from "@/lib/db";
import { sportColor } from "@/lib/sport-color";

type Props = { rows: WorkoutRow[] };

const ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X"];

const CX = 80;
const CY = 80;
const R_OUTER = 70;
const R_INNER = 44;

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

function slicePath(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number): string {
  const ox1 = cx + rOuter * Math.cos(startAngle);
  const oy1 = cy + rOuter * Math.sin(startAngle);
  const ox2 = cx + rOuter * Math.cos(endAngle);
  const oy2 = cy + rOuter * Math.sin(endAngle);
  const ix1 = cx + rInner * Math.cos(endAngle);
  const iy1 = cy + rInner * Math.sin(endAngle);
  const ix2 = cx + rInner * Math.cos(startAngle);
  const iy2 = cy + rInner * Math.sin(startAngle);
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${ox1} ${oy1}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${ox2} ${oy2}`,
    `L ${ix1} ${iy1}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${ix2} ${iy2}`,
    "Z",
  ].join(" ");
}

export default function SportDonut({ rows }: Props) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = r.sport ?? "Other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const slices = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([sport, count]) => ({ sport, count, color: sportColor(sport) }));

  const total = slices.reduce((a, s) => a + s.count, 0);

  const START = -Math.PI / 2;
  let acc = 0;
  const arcs = slices.map((s) => {
    const startAngle = START + (acc / total) * 2 * Math.PI;
    acc += s.count;
    const endAngle = START + (acc / total) * 2 * Math.PI;
    return { ...s, d: slicePath(CX, CY, R_OUTER, R_INNER, startAngle, endAngle) };
  });

  return (
    <div className="atelier-sport-donut">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">III. Distribution / Plate N&#xba; 03</span>
        <span className="atelier-plate-page">003 / 003</span>
      </div>

      {total === 0 ? (
        <div className="atelier-chart-empty">No workout data in this window.</div>
      ) : (
        <div className="atelier-sport-donut-body">
          <svg viewBox="0 0 160 160" className="atelier-sport-donut-svg">
            {arcs.map((arc, i) => (
              <path key={i} d={arc.d} fill={arc.color} />
            ))}
            <text x={CX} y={CY - 6} textAnchor="middle" className="atelier-sport-donut-center-num">
              {total}
            </text>
            <text x={CX} y={CY + 10} textAnchor="middle" className="atelier-sport-donut-center-label">
              sessions
            </text>
          </svg>

          <div className="atelier-sport-donut-legend">
            {arcs.map((s, i) => (
              <div key={s.sport} className="atelier-sport-donut-legend-row">
                <span className="atelier-sport-donut-legend-roman">{ROMAN[i] ?? String(i + 1)}</span>
                <span
                  className="atelier-sport-donut-legend-dot"
                  style={{ background: s.color }}
                />
                <span className="atelier-sport-donut-legend-label">{s.sport}</span>
                <span className="atelier-sport-donut-legend-count">{s.count}</span>
                <span className="atelier-sport-donut-legend-pct">
                  {((s.count / total) * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
