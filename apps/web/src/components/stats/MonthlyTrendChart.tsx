import type { MonthlyRollupRow } from "@/lib/db";

// Server-rendered inline SVG (no client JS): monthly session-count bars with
// an overlaid per-month average line. Shared by `/stats` (avg strain over all
// sports) and `/stats/[sport]` (avg strain / avg HR for one sport, #430), so
// both read the same `getMonthlyRollup` series the same way.

export type TrendLineKey = "avgStrain" | "avgHr";

export type TrendPoint = { month: string; value: number };

/** The non-null points of one rollup metric, in month order. */
export function trendLineSeries(months: MonthlyRollupRow[], key: TrendLineKey): TrendPoint[] {
  const out: TrendPoint[] = [];
  for (const m of months) {
    const v = m[key];
    if (v != null) out.push({ month: m.month, value: v });
  }
  return out;
}

function monthLabel(ym: string): string {
  return new Date(ym + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" });
}

export default function MonthlyTrendChart({
  months,
  line = "avgStrain",
  barColor = "#2563eb",
  lineColor = "#ffaa00",
  formatLineValue,
}: {
  months: MonthlyRollupRow[];
  line?: TrendLineKey;
  barColor?: string;
  lineColor?: string;
  /** When set, each line point is labelled with this formatted value. */
  formatLineValue?: (v: number) => string;
}) {
  const W = 760;
  const H = 240;
  const padL = 34;
  const padR = 34;
  const padT = 16;
  const padB = 30;
  const n = months.length;
  if (n === 0) return null;
  const slot = (W - padL - padR) / n;
  const bw = slot * 0.56;
  const mxC = Math.max(...months.map((d) => d.count), 1);

  const series = trendLineSeries(months, line);
  const hasLine = series.length > 0;
  const vals = series.map((p) => p.value);
  let mnS = hasLine ? Math.floor(Math.min(...vals)) : 0;
  let mxS = hasLine ? Math.ceil(Math.max(...vals)) : 1;
  if (mnS === mxS) {
    mnS -= 1;
    mxS += 1;
  }

  const bx = (i: number) => padL + slot * i + slot * 0.22;
  const byTop = (c: number) => padT + (1 - c / mxC) * (H - padT - padB);
  const syY = (s: number) => padT + (1 - (s - mnS) / (mxS - mnS)) * (H - padT - padB);

  const pointAt = months
    .map((d, i) => {
      const v = d[line];
      return v != null ? { i, v, x: bx(i) + bw / 2, y: syY(v), month: d.month } : null;
    })
    .filter((p): p is { i: number; v: number; x: number; y: number; month: string } => p != null);

  const anyPartial = months.some((d) => d.partial);

  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: "auto", aspectRatio: `${W} / ${H}` }}
        data-trend-line={line}
        data-points={pointAt.length}
      >
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="rgba(255,255,255,0.08)" />
        {months.map((d, i) => {
          const top = byTop(d.count);
          const barH = H - padB - top;
          return (
            <g key={d.month}>
              <rect
                x={bx(i)}
                y={top}
                width={bw}
                height={Math.max(0, barH)}
                rx={3}
                fill={barColor}
                opacity={d.partial ? 0.42 : 0.85}
              />
              {!formatLineValue && (
                <text
                  x={bx(i) + bw / 2}
                  y={top - 6}
                  textAnchor="middle"
                  fill="#a1a1aa"
                  fontFamily="Geist Mono"
                  fontSize={10}
                  fontWeight={600}
                >
                  {d.count}
                </text>
              )}
            </g>
          );
        })}
        {pointAt.length > 1 && (
          <polyline
            points={pointAt.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
            fill="none"
            stroke={lineColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {pointAt.map((p) => (
          <g key={`pt-${p.month}`}>
            <circle cx={p.x} cy={p.y} r={3} fill={lineColor} />
            {formatLineValue && (
              <text
                x={p.x}
                y={p.y - 8}
                textAnchor="middle"
                fill={lineColor}
                fontFamily="Geist Mono"
                fontSize={10}
                fontWeight={600}
              >
                {formatLineValue(p.v)}
              </text>
            )}
          </g>
        ))}
        {months.map((d, i) => (
          <text
            key={`x-${d.month}`}
            x={bx(i) + bw / 2}
            y={H - padB + 18}
            textAnchor="middle"
            fill="#6b6b74"
            fontFamily="Geist Mono"
            fontSize={10}
          >
            {monthLabel(d.month)}
            {d.partial ? "*" : ""}
          </text>
        ))}
      </svg>
      {anyPartial && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            color: "var(--fg-4)",
            marginTop: 4,
            textAlign: "right",
          }}
        >
          * partial month
        </div>
      )}
    </>
  );
}
