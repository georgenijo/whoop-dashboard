import {
  ACUTE_DAYS,
  CHRONIC_DAYS,
  LOAD_ZONES,
  formatRatio,
  zoneMeta,
  type LoadPoint,
  type LoadSummary,
} from "@/lib/analytics/acwr";

/** Chart y-axis ceiling; ratios above it are drawn at the top edge. */
export const CHART_MAX_RATIO = 2;

const ACCENT = "#00d4aa";

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function y(ratio: number): number {
  const clamped = Math.min(Math.max(ratio, 0), CHART_MAX_RATIO);
  return 100 - (clamped / CHART_MAX_RATIO) * 100;
}

/** SVG path for the ratio line, broken (new `M`) wherever the ratio is null. */
export function ratioPath(series: readonly LoadPoint[]): string {
  const n = series.length;
  if (n === 0) return "";
  const step = n === 1 ? 0 : 100 / (n - 1);
  let d = "";
  let pen = false;
  series.forEach((p, i) => {
    if (p.ratio === null) {
      pen = false;
      return;
    }
    const x = n === 1 ? 50 : i * step;
    d += `${pen ? "L" : "M"}${x.toFixed(2)},${y(p.ratio).toFixed(2)} `;
    pen = true;
  });
  return d.trim();
}

function statusLabel(p: LoadPoint): string {
  switch (p.status) {
    case "ok":
      return zoneMeta(p.zone!).label;
    case "building":
      return "Building baseline";
    case "sparse":
      return "Not enough data";
    case "zero-baseline":
      return "No baseline load";
    case "no-data":
      return "No data";
  }
}

function statusColor(p: LoadPoint): string {
  return p.status === "ok" ? zoneMeta(p.zone!).color : "var(--fg-3)";
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="card-sub" style={{ color: "var(--fg-3)" }}>{label}</div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 28,
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
          color: color ?? "var(--fg-1)",
          margin: "4px 0 2px",
        }}
      >
        {value}
      </div>
      <div className="card-sub">{sub}</div>
    </div>
  );
}

function strainText(v: number | null): string {
  return v === null ? "—" : v.toFixed(1);
}

export default function TrainingLoadView({ summary }: { summary: LoadSummary }) {
  const { current, series, projection } = summary;
  const hasLine = series.some((p) => p.ratio !== null);
  const axis = [0, 21, 42, 63, series.length - 1]
    .filter((i) => i >= 0 && i < series.length)
    .map((i) => series[i].date);

  return (
    <>
      <div className="card" data-testid="load-hero">
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: ACCENT, color: ACCENT }} />
              Training Load Balance
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              Acute ({ACUTE_DAYS}-day) vs chronic ({CHRONIC_DAYS}-day) average daily strain · today includes strain so far
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 12,
          }}
        >
          <Kpi
            label="Today's ratio"
            value={formatRatio(current.ratio)}
            sub={statusLabel(current)}
            color={statusColor(current)}
          />
          <Kpi label={`Acute · ${ACUTE_DAYS}d avg`} value={strainText(current.acute)} sub={`${current.acuteDays}/${ACUTE_DAYS} days with data`} />
          <Kpi label={`Chronic · ${CHRONIC_DAYS}d avg`} value={strainText(current.chronic)} sub={`${current.chronicDays}/${CHRONIC_DAYS} days with data`} />
        </div>

        <p data-testid="load-suggestion" style={{ margin: "16px 0 0", color: "var(--fg-2)", fontSize: 14 }}>
          {summary.suggestion}
        </p>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: ACCENT, color: ACCENT }} />
              Acute:chronic ratio · 12 weeks
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              Shaded bands are the load zones · ratios above {CHART_MAX_RATIO.toFixed(1)} are drawn at the top
            </div>
          </div>
        </div>

        {hasLine ? (
          <>
            <div className="chart-body" style={{ position: "relative" }}>
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                role="img"
                aria-label={`Acute to chronic training load ratio over 12 weeks; today ${formatRatio(current.ratio)}`}
                style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
              >
                {LOAD_ZONES.map((z) => {
                  const top = y(Math.min(z.max, CHART_MAX_RATIO));
                  const bottom = y(z.min);
                  return (
                    <rect
                      key={z.zone}
                      data-zone={z.zone}
                      x="0"
                      y={top}
                      width="100"
                      height={Math.max(0, bottom - top)}
                      fill={z.color}
                      opacity={z.zone === "sweet-spot" ? 0.12 : 0.06}
                    />
                  );
                })}
                <line
                  x1="0"
                  x2="100"
                  y1={y(1)}
                  y2={y(1)}
                  stroke="rgba(255,255,255,0.18)"
                  strokeDasharray="1.5 1.5"
                  strokeWidth="0.4"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1="100"
                  x2="100"
                  y1="0"
                  y2="100"
                  stroke="rgba(255,255,255,0.3)"
                  strokeDasharray="1 1.5"
                  strokeWidth="0.4"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  data-testid="load-ratio-line"
                  d={ratioPath(series)}
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>
            <div className="chart-axis">
              {axis.map((d, i) => (
                <span key={`${d}-${i}`}>{i === axis.length - 1 ? "Today" : shortDate(d)}</span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
              {LOAD_ZONES.map((z) => (
                <span key={z.zone} className="card-sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: z.color, display: "inline-block" }} />
                  {z.label} {Number.isFinite(z.max) ? `${z.min.toFixed(1)}–${z.max.toFixed(1)}` : `> ${z.min.toFixed(1)}`}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="title">
              {current.status === "building" ? "Building baseline" : "No ratio to chart yet"}
            </div>
            <div className="sub">
              The ratio needs {CHRONIC_DAYS} days of strain history
              {summary.baselineDaysRemaining > 0 ? ` — ${summary.baselineDaysRemaining} to go` : ""}
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: "#ffaa00", color: "#ffaa00" }} />
              What would tomorrow do?
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              Projected ratio for {shortDate(projection.date)} if tomorrow&apos;s day strain is…
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <Kpi
            label={`Rest day · strain ${projection.restStrain}`}
            value={formatRatio(projection.rest.ratio)}
            sub={statusLabel(projection.rest)}
            color={statusColor(projection.rest)}
          />
          <Kpi
            label={`Hard day · strain ${projection.hardStrain}`}
            value={formatRatio(projection.hard.ratio)}
            sub={statusLabel(projection.hard)}
            color={statusColor(projection.hard)}
          />
        </div>
      </div>

      <p className="card-sub" style={{ marginTop: 16 }}>
        Ratio = mean daily strain over the last {ACUTE_DAYS} days ÷ mean over the last {CHRONIC_DAYS} days, counting
        only days with strain data. A training-balance guide, not medical advice.
      </p>
    </>
  );
}
