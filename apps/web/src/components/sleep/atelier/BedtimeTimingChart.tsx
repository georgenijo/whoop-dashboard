import { smoothPath } from "@/lib/paths";
import { pickAxisLabels } from "@/lib/atelier-format";
import type { SleepRow } from "@/lib/db";

type Props = { rows: SleepRow[] };

/** Parse an ISO local timestamp → decimal hour (0..23.999) */
function parseHourDecimal(iso: string | null): number | null {
  if (!iso) return null;
  const timePart = iso.includes("T") ? iso.split("T")[1] : iso;
  if (!timePart) return null;
  const [hStr, mStr] = timePart.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr ?? "0", 10);
  if (Number.isNaN(h)) return null;
  return h + m / 60;
}

/**
 * Normalize bedtime so it plots sensibly on a midnight-crossing axis.
 * Hours 0..6 are treated as "after midnight" → mapped to 24..30.
 */
function normalizeBedHour(h: number): number {
  return h < 6 ? h + 24 : h;
}

/** Format a decimal hour as HH:MM (24h) */
function fmtHour24(h: number): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h % 1) * 60) % 60;
  return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
}

/** Format a decimal hour as human-readable 12h string */
function fmtHour12(h: number): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h % 1) * 60) % 60;
  const ampm = hh >= 12 ? "pm" : "am";
  const display = hh % 12 || 12;
  return `${display}:${mm.toString().padStart(2, "0")}${ampm}`;
}

export default function BedtimeTimingChart({ rows }: Props) {
  const validRows = rows.filter(
    (r) => r.start_local != null || r.end_local != null
  );

  if (validRows.length < 2) {
    return (
      <div className="atelier-bedtime-timing">
        <div className="atelier-plate-head">
          <span className="atelier-plate-fig">FIG. 05 / SL-27</span>
          <span className="atelier-plate-page">bedtime · wake timing</span>
        </div>
        <p className="atelier-chart-empty">Not enough timing data</p>
      </div>
    );
  }

  // Parse and normalize hours
  const bedHours: (number | null)[] = rows.map((r) => {
    const h = parseHourDecimal(r.start_local);
    return h != null ? normalizeBedHour(h) : null;
  });
  const wakeHours: (number | null)[] = rows.map((r) =>
    parseHourDecimal(r.end_local)
  );

  // Compute chart bounds across both series
  const allBed = bedHours.filter((v): v is number => v != null);
  const allWake = wakeHours.filter((v): v is number => v != null);

  if (allBed.length < 2 && allWake.length < 2) {
    return (
      <div className="atelier-bedtime-timing">
        <div className="atelier-plate-head">
          <span className="atelier-plate-fig">FIG. 05 / SL-27</span>
          <span className="atelier-plate-page">bedtime · wake timing</span>
        </div>
        <p className="atelier-chart-empty">Not enough timing data</p>
      </div>
    );
  }

  // Average markers
  const avgBed = allBed.length
    ? allBed.reduce((a, b) => a + b, 0) / allBed.length
    : null;
  const avgWake = allWake.length
    ? allWake.reduce((a, b) => a + b, 0) / allWake.length
    : null;

  // SVG coordinate system: 0 0 100 100 (viewBox), Y=0 is top
  const W = 100;
  const H = 100;
  const n = rows.length > 1 ? rows.length - 1 : 1;

  // Determine y-axis range with padding
  const allVals = [...allBed, ...allWake];
  const rawMin = Math.min(...allVals);
  const rawMax = Math.max(...allVals);
  const pad = (rawMax - rawMin) * 0.15 || 1;
  const minV = rawMin - pad;
  const maxV = rawMax + pad;
  const rangeV = maxV - minV;

  function toSvgY(val: number): number {
    return H - ((val - minV) / rangeV) * H;
  }

  function toPoints(vals: (number | null)[]): [number, number][] {
    return vals
      .map((v, i) =>
        v != null
          ? ([((i / n) * W), toSvgY(v)] as [number, number])
          : null
      )
      .filter((p): p is [number, number] => p != null);
  }

  const bedPts = toPoints(bedHours);
  const wakePts = toPoints(wakeHours);
  const bedLine = smoothPath(bedPts);
  const wakeLine = smoothPath(wakePts);

  const axisLabels = pickAxisLabels(rows);

  // Y-axis tick labels (3 ticks: top, mid, bottom)
  const yTicks = [minV + rangeV * 0.85, minV + rangeV * 0.5, minV + rangeV * 0.15];

  return (
    <div className="atelier-bedtime-timing">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">FIG. 05 / SL-27</span>
        <span className="atelier-plate-page">bedtime · wake timing</span>
      </div>

      <div className="atelier-trend-legend">
        <span style={{ color: "var(--coral)" }}>&#9472; Bedtime</span>
        <span style={{ color: "var(--mustard)" }}>&#9472; Wake time</span>
        {avgBed != null && (
          <span style={{ color: "var(--ink-faint)" }}>
            avg bed {fmtHour12(avgBed % 24)}
          </span>
        )}
        {avgWake != null && (
          <span style={{ color: "var(--ink-faint)" }}>
            avg wake {fmtHour12(avgWake)}
          </span>
        )}
      </div>

      <div className="atelier-bedtime-chart-body">
        {/* Y-axis labels */}
        <div className="atelier-bedtime-y-axis" aria-hidden>
          {yTicks.map((t, i) => (
            <span key={i}>{fmtHour24(t < 0 ? 0 : t % 24)}</span>
          ))}
        </div>

        <div className="atelier-bedtime-chart-inner">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-label="Bedtime and wake time trend chart"
          >
            {/* Horizontal grid lines */}
            {yTicks.map((t, i) => (
              <line
                key={i}
                x1="0"
                y1={toSvgY(t)}
                x2="100"
                y2={toSvgY(t)}
                stroke="var(--line-soft)"
                strokeWidth="0.4"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* Average bedtime dashed line */}
            {avgBed != null && (
              <line
                x1="0"
                y1={toSvgY(avgBed)}
                x2="100"
                y2={toSvgY(avgBed)}
                stroke="var(--coral)"
                strokeWidth="0.6"
                strokeDasharray="2 2"
                strokeOpacity="0.35"
                vectorEffect="non-scaling-stroke"
              />
            )}

            {/* Average wake time dashed line */}
            {avgWake != null && (
              <line
                x1="0"
                y1={toSvgY(avgWake)}
                x2="100"
                y2={toSvgY(avgWake)}
                stroke="var(--mustard)"
                strokeWidth="0.6"
                strokeDasharray="2 2"
                strokeOpacity="0.35"
                vectorEffect="non-scaling-stroke"
              />
            )}

            {/* Bedtime line */}
            {bedPts.length > 1 && (
              <path
                d={bedLine}
                fill="none"
                stroke="var(--coral)"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}

            {/* Bedtime dots */}
            {bedPts.map(([x, y], i) => (
              <circle
                key={`bed-${i}`}
                cx={x}
                cy={y}
                r="1.2"
                fill="var(--coral)"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* Wake time line */}
            {wakePts.length > 1 && (
              <path
                d={wakeLine}
                fill="none"
                stroke="var(--mustard)"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}

            {/* Wake dots */}
            {wakePts.map(([x, y], i) => (
              <circle
                key={`wake-${i}`}
                cx={x}
                cy={y}
                r="1.2"
                fill="var(--mustard)"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        </div>
      </div>

      <div className="atelier-chart-axis">
        {axisLabels.map((lbl, i) => (
          <span key={`${lbl}-${i}`}>{lbl}</span>
        ))}
      </div>
    </div>
  );
}
