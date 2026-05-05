import { smoothPath, sparklinePoints } from "@/lib/paths";
import { pickAxisLabels } from "@/lib/atelier-format";
import type { SleepRow } from "@/lib/db";

type Props = { rows: SleepRow[] };

export default function SleepTrendCard({ rows }: Props) {
  const sleepVals = rows.map((r) =>
    r.in_bed_ms != null && r.awake_ms != null
      ? (r.in_bed_ms - r.awake_ms) / 3_600_000
      : null
  );
  const needVals = rows.map((r) =>
    r.sleep_need_ms != null ? r.sleep_need_ms / 3_600_000 : null
  );

  const sleepFiltered = sleepVals.filter((v): v is number => v != null);
  const needFiltered = needVals.filter((v): v is number => v != null);

  const axisLabels = pickAxisLabels(rows);

  const allVals = [...sleepFiltered, ...needFiltered];
  const minV = allVals.length ? Math.min(...allVals) : 0;
  const maxV = allVals.length ? Math.max(...allVals) : 10;
  const rangeV = maxV - minV || 1;
  const W = 100;
  const H = 100;
  const n = rows.length > 1 ? rows.length - 1 : 1;

  function toPoints(vals: (number | null)[]): [number, number][] {
    return vals
      .map((v, i) =>
        v != null
          ? ([((i / n) * W), H - ((v - minV) / rangeV) * H] as [number, number])
          : null
      )
      .filter((p): p is [number, number] => p != null);
  }

  const sleepPts = toPoints(sleepVals);
  const needPts = toPoints(needVals);

  const sleepLine = smoothPath(sleepPts);
  const needLine = smoothPath(needPts);

  if (sleepFiltered.length < 2) {
    return (
      <div className="atelier-sleep-trend">
        <div className="atelier-plate-head">
          <span className="atelier-plate-fig">FIG. 02 / SL-26</span>
        </div>
        <p className="atelier-chart-empty">Not enough sleep data</p>
      </div>
    );
  }

  return (
    <div className="atelier-sleep-trend">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">FIG. 02 / SL-26</span>
        <span className="atelier-plate-page">14-day trend</span>
      </div>
      <div className="atelier-trend-legend">
        <span style={{ color: "#ed6f5c" }}>&#9472; Total sleep (h)</span>
        <span style={{ color: "#e9b94a" }}>&#9472; Need (h)</span>
      </div>
      <div className="atelier-chart-body">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="sleep-trend-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ed6f5c" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#ed6f5c" stopOpacity="0" />
            </linearGradient>
          </defs>
          {sleepPts.length > 1 && (
            <>
              <path
                d={`${sleepLine} L ${sleepPts[sleepPts.length - 1][0]},${H} L ${sleepPts[0][0]},${H} Z`}
                fill="url(#sleep-trend-area)"
              />
              <path
                d={sleepLine}
                fill="none"
                stroke="#ed6f5c"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
          {needPts.length > 1 && (
            <path
              d={needLine}
              fill="none"
              stroke="#e9b94a"
              strokeWidth="1"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray="3 2"
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
    </div>
  );
}
