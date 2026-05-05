import { pickAxisLabels } from "@/lib/atelier-format";
import type { SleepRow } from "@/lib/db";

type Props = { rows: SleepRow[] };

function parseHour(iso: string | null): number | null {
  if (!iso) return null;
  const t = iso.split("T")[1] ?? iso;
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr ?? "0", 10);
  if (Number.isNaN(h)) return null;
  return h + m / 60;
}

function normalizeWakeHour(h: number): number {
  // wrap hours <12 to be plotted after midnight (e.g. 6am → 30)
  return h < 12 ? h + 24 : h;
}

export default function SleepConsistencyCard({ rows }: Props) {
  const points = rows
    .map((r, i) => ({
      i,
      bed: parseHour(r.start_local),
      wake: parseHour(r.end_local),
    }))
    .filter((p) => p.bed != null && p.wake != null) as {
      i: number;
      bed: number;
      wake: number;
    }[];

  const axisLabels = pickAxisLabels(rows);

  if (points.length < 2) {
    return (
      <div className="atelier-sleep-consistency">
        <div className="atelier-plate-head">
          <span className="atelier-plate-fig">FIG. 03 / SL-26</span>
        </div>
        <p className="atelier-chart-empty">Not enough data</p>
      </div>
    );
  }

  const bedHours = points.map((p) => p.bed);
  const wakeHours = points.map((p) => normalizeWakeHour(p.wake));

  const medianBed = [...bedHours].sort((a, b) => a - b)[Math.floor(bedHours.length / 2)];
  const medianWake = [...wakeHours].sort((a, b) => a - b)[Math.floor(wakeHours.length / 2)];

  const allH = [...bedHours, ...wakeHours];
  const minH = Math.min(...allH);
  const maxH = Math.max(...allH);
  const rangeH = maxH - minH || 1;
  const n = rows.length > 1 ? rows.length - 1 : 1;
  const W = 100;
  const H = 100;

  function toY(h: number) {
    return H - ((h - minH) / rangeH) * H;
  }

  const medBedY = toY(medianBed);
  const medWakeY = toY(medianWake);

  return (
    <div className="atelier-sleep-consistency">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">FIG. 03 / SL-26</span>
        <span className="atelier-plate-page">bedtime · wake jitter</span>
      </div>
      <div className="atelier-trend-legend">
        <span style={{ color: "#2a3a5c" }}>&#9679; Bedtime</span>
        <span style={{ color: "#ed6f5c" }}>&#9679; Wake</span>
      </div>
      <div className="atelier-chart-body">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {/* median hairlines */}
          <line
            x1="0" y1={medBedY} x2="100" y2={medBedY}
            stroke="#2a3a5c" strokeWidth="0.4" strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1="0" y1={medWakeY} x2="100" y2={medWakeY}
            stroke="#ed6f5c" strokeWidth="0.4" strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
          {/* scatter dots */}
          {points.map((p) => {
            const x = (p.i / n) * W;
            return (
              <g key={p.i}>
                <circle
                  cx={x} cy={toY(p.bed)} r="1.8"
                  fill="#2a3a5c" fillOpacity="0.85"
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={x} cy={toY(normalizeWakeHour(p.wake))} r="1.8"
                  fill="#ed6f5c" fillOpacity="0.85"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
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
