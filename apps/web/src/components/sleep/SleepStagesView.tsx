import Link from "next/link";
import {
  HISTORY_DAYS,
  MIN_NIGHTS,
  STAGE_KEYS,
  STAGE_LABEL,
  STAGE_WINDOWS,
  STEADY_MIN,
  TREND_DAYS,
  formatMin,
  type Position,
  type SleepStagesResult,
  type StageKey,
  type StageNight,
  type StageTrend,
  type TypicalRange,
} from "@/lib/analytics/sleepStages";

const ACCENT = "#0055ff";

/** Same palette as `SleepStagesChart`. */
export const STAGE_COLOR: Record<StageKey, string> = {
  deep: "#0055ff",
  rem: "#7b61ff",
  light: "#00d4aa",
  awake: "#3f3f46",
};

const POSITION_COLOR: Record<Position, string> = {
  below: "#ffaa00",
  within: "#00d4aa",
  above: "#00aaff",
};

const POSITION_LABEL: Record<Position, string> = {
  below: "Below your range",
  within: "Within your range",
  above: "Above your range",
};

// Stacked-bar chart geometry; y is minutes from 0 (bottom).
const CHART_W = 600;
const CHART_H = 240;
const PAD_L = 36;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 22;
const PLOT_H = CHART_H - PAD_T - PAD_B;
const PLOT_W = CHART_W - PAD_L - PAD_R;

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function dayIndex(start: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
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

function WindowPicker({ current }: { current: number }) {
  return (
    <div style={{ display: "flex", gap: 6 }} data-testid="stages-window">
      {STAGE_WINDOWS.map((w) => (
        <Link
          key={w}
          href={`/sleep/stages?days=${w}`}
          aria-current={w === current ? "page" : undefined}
          className="card-sub"
          style={{
            padding: "4px 10px",
            borderRadius: 999,
            border: "1px solid var(--line, rgba(255,255,255,0.12))",
            color: w === current ? "var(--fg-1)" : "var(--fg-3)",
            background: w === current ? "rgba(0,85,255,0.18)" : "transparent",
            textDecoration: "none",
          }}
        >
          {`${w} days`}
        </Link>
      ))}
    </div>
  );
}

/** Round the y-axis max up to the next whole hour (min 1h). */
function axisMaxMin(nights: readonly StageNight[]): number {
  const top = Math.max(60, ...nights.map((n) => n.total));
  return Math.ceil(top / 60) * 60;
}

export function StageBarsChart({
  nights,
  start,
  windowDays,
}: {
  nights: readonly StageNight[];
  start: string;
  windowDays: number;
}) {
  const maxMin = axisMaxMin(nights);
  const y = (min: number) => PAD_T + PLOT_H - (Math.min(min, maxMin) / maxMin) * PLOT_H;
  const slot = PLOT_W / windowDays;
  const barW = Math.max(2, Math.min(18, slot * 0.7));
  const hourStep = maxMin > 8 * 60 ? 2 : 1;
  const ticks: number[] = [];
  for (let h = 0; h * 60 <= maxMin; h += hourStep) ticks.push(h);
  // Bottom-up stacking: deep, REM, light, awake.
  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      role="img"
      aria-label={`Sleep stage minutes for each of ${nights.length} nights over the last ${windowDays} days`}
      style={{ width: "100%", height: "auto", display: "block" }}
      data-testid="stages-chart"
    >
      {ticks.map((h) => (
        <g key={h}>
          <line x1={PAD_L} x2={CHART_W - PAD_R} y1={y(h * 60)} y2={y(h * 60)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <text x={PAD_L - 6} y={y(h * 60) + 3} textAnchor="end" fontSize="10" fontFamily="var(--font-mono)" fill="var(--fg-3)">
            {`${h}h`}
          </text>
        </g>
      ))}
      {nights.map((n) => {
        const i = dayIndex(start, n.date);
        const x = PAD_L + slot * (i + 0.5) - barW / 2;
        let acc = 0;
        return (
          <g key={n.date} data-night={n.date}>
            <title>
              {`${shortDate(n.date)}: deep ${formatMin(n.deep)}, REM ${formatMin(n.rem)}, light ${formatMin(n.light)}, awake ${formatMin(n.awake)}`}
            </title>
            {STAGE_KEYS.map((k) => {
              const y0 = y(acc);
              acc += n[k];
              const y1 = y(acc);
              return (
                <rect
                  key={k}
                  data-stage={k}
                  x={x.toFixed(1)}
                  y={y1.toFixed(1)}
                  width={barW.toFixed(1)}
                  height={Math.max(0, y0 - y1).toFixed(1)}
                  fill={STAGE_COLOR[k]}
                  opacity="0.9"
                />
              );
            })}
          </g>
        );
      })}
      {[0, Math.floor(windowDays / 2), windowDays - 1].map((i) => {
        const d = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
        return (
          <text key={i} x={PAD_L + slot * (i + 0.5)} y={CHART_H - 6} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--fg-3)">
            {i === windowDays - 1 ? "Today" : shortDate(d)}
          </text>
        );
      })}
    </svg>
  );
}

function Legend() {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
      {STAGE_KEYS.map((k) => (
        <span key={k} className="card-sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: STAGE_COLOR[k], display: "inline-block" }} />
          {STAGE_LABEL[k]}
        </span>
      ))}
    </div>
  );
}

function StatsTable({ stats }: { stats: Extract<SleepStagesResult, { status: "ok" }>["stats"] }) {
  const cell = { padding: "8px 10px", textAlign: "right" as const, fontVariantNumeric: "tabular-nums" as const };
  return (
    <div style={{ overflowX: "auto" }}>
      <table data-testid="stages-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr className="card-sub">
            <th style={{ ...cell, textAlign: "left" }}>Stage</th>
            <th style={cell}>Avg</th>
            <th style={cell}>Median</th>
            <th style={cell}>Avg %</th>
            <th style={cell}>Median %</th>
          </tr>
        </thead>
        <tbody>
          {STAGE_KEYS.map((k) => (
            <tr key={k} data-stage-row={k} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "var(--fg-1)" }}>
              <td style={{ ...cell, textAlign: "left" }}>
                <span className="dot" style={{ background: STAGE_COLOR[k], color: STAGE_COLOR[k], marginRight: 8 }} />
                {STAGE_LABEL[k]}
              </td>
              <td style={cell}>{formatMin(stats[k].meanMin)}</td>
              <td style={cell}>{formatMin(stats[k].medianMin)}</td>
              <td style={cell}>{`${stats[k].meanPct.toFixed(0)}%`}</td>
              <td style={cell}>{`${stats[k].medianPct.toFixed(0)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Horizontal gauge: p25–p75 band with the latest night marked. */
function RangeCard({ label, range, latestDate }: { label: string; range: TypicalRange | null; latestDate: string | null }) {
  const color = range ? POSITION_COLOR[range.position] : "var(--fg-3)";
  return (
    <div className="card" data-testid={`range-${label.toLowerCase()}`}>
      <div className="card-head">
        <div className="card-title">
          <span className="dot" style={{ background: label === "Deep" ? STAGE_COLOR.deep : STAGE_COLOR.rem, color: label === "Deep" ? STAGE_COLOR.deep : STAGE_COLOR.rem }} />
          {`Your typical ${label === "Deep" ? "deep" : "REM"}`}
        </div>
      </div>
      {!range ? (
        <div className="card-sub">{`Needs ${MIN_NIGHTS} earlier nights with stage data.`}</div>
      ) : (
        (() => {
          const lo = Math.min(range.p25, range.latest) * 0.8;
          const hi = Math.max(range.p75, range.latest) * 1.15 || 1;
          const at = (v: number) => `${(((v - lo) / (hi - lo)) * 100).toFixed(1)}%`;
          return (
            <>
              <div style={{ fontSize: 22, fontFamily: "var(--font-display)", color: "var(--fg-1)", fontVariantNumeric: "tabular-nums" }}>
                {`${Math.round(range.p25)}–${Math.round(range.p75)} min`}
              </div>
              <div className="card-sub" style={{ marginBottom: 14 }}>{`25th–75th percentile of ${range.n} earlier nights`}</div>
              <div style={{ position: "relative", height: 14, borderRadius: 7, background: "rgba(255,255,255,0.06)" }}>
                <div
                  style={{
                    position: "absolute",
                    left: at(range.p25),
                    width: `calc(${at(range.p75)} - ${at(range.p25)})`,
                    top: 0,
                    bottom: 0,
                    borderRadius: 7,
                    background: "rgba(0,212,170,0.25)",
                  }}
                />
                <div
                  data-testid={`marker-${label.toLowerCase()}`}
                  data-position={range.position}
                  style={{ position: "absolute", left: at(range.latest), top: -4, width: 3, height: 22, marginLeft: -1.5, borderRadius: 2, background: color }}
                />
              </div>
              <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span className="card-sub">{`Latest${latestDate ? ` · ${shortDate(latestDate)}` : ""}: ${formatMin(range.latest)}`}</span>
                <span className="card-sub" style={{ color }}>{POSITION_LABEL[range.position]}</span>
              </div>
            </>
          );
        })()
      )}
    </div>
  );
}

function TrendCard({ label, trend }: { label: string; trend: StageTrend }) {
  const arrow = trend.direction === "up" ? "↑" : trend.direction === "down" ? "↓" : trend.direction === "steady" ? "→" : "";
  const color = trend.direction === "up" ? "#00d4aa" : trend.direction === "down" ? "#ffaa00" : "var(--fg-1)";
  const rows: [string, string][] = [
    [`Last ${TREND_DAYS} days`, trend.recentNights ? `${formatMin(trend.recentMean)} avg · ${trend.recentNights} nights` : "—"],
    [`Prior ${TREND_DAYS} days`, trend.priorMean != null ? `${formatMin(trend.priorMean)} avg · ${trend.priorNights} nights` : `Needs ${MIN_NIGHTS} nights (${trend.priorNights})`],
    ["Slope (last 30)", trend.slopePerWeek != null ? `${trend.slopePerWeek >= 0 ? "+" : "−"}${Math.abs(trend.slopePerWeek).toFixed(1)} min/week` : "—"],
  ];
  return (
    <div className="card" data-testid={`trend-${label.toLowerCase()}`}>
      <div className="card-head">
        <div className="card-title">
          <span className="dot" style={{ background: label === "Deep" ? STAGE_COLOR.deep : STAGE_COLOR.rem, color: label === "Deep" ? STAGE_COLOR.deep : STAGE_COLOR.rem }} />
          {`${label} trend`}
        </div>
      </div>
      <div style={{ fontSize: 22, fontFamily: "var(--font-display)", color, fontVariantNumeric: "tabular-nums", marginBottom: 10 }}>
        {trend.delta == null ? "—" : `${arrow} ${trend.delta >= 0 ? "+" : "−"}${Math.abs(Math.round(trend.delta))} min`}
      </div>
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", margin: 0 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt className="card-sub" style={{ alignSelf: "center" }}>{k}</dt>
            <dd style={{ margin: 0, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--fg-1)" }}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function SleepStagesView({ result }: { result: SleepStagesResult }) {
  const header = (
    <div className="card-head" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
      <div>
        <div className="card-title">
          <span className="dot" style={{ background: ACCENT, color: ACCENT }} />
          Sleep Stages
        </div>
        <div className="card-sub" style={{ marginTop: 4 }}>
          {`Last ${result.windowDays} days · ${shortDate(result.start)} – ${shortDate(result.end)} · naps excluded`}
        </div>
      </div>
      <WindowPicker current={result.windowDays} />
    </div>
  );

  if (result.status === "insufficient") {
    return (
      <div className="card" data-testid="stages-hero">
        {header}
        <div className="empty-state" data-testid="stages-insufficient">
          <div className="title">Not enough data yet</div>
          <div className="sub">
            {`Stage breakdowns need at least ${MIN_NIGHTS} nights with stage data in the last ${result.windowDays} days — ${result.nights.length} so far`}
            {result.noStageNights > 0 ? ` (${result.noStageNights} recorded with no stage data).` : "."}
          </div>
        </div>
      </div>
    );
  }

  const { stats, latest, ranges, trends, takeaway } = result;
  return (
    <>
      <div className="card" data-testid="stages-hero">
        {header}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <Kpi label="Avg deep" value={formatMin(stats.deep.meanMin)} sub={`${stats.deep.meanPct.toFixed(0)}% of the night`} color={STAGE_COLOR.deep} />
          <Kpi label="Avg REM" value={formatMin(stats.rem.meanMin)} sub={`${stats.rem.meanPct.toFixed(0)}% of the night`} color={STAGE_COLOR.rem} />
          <Kpi label="Avg light" value={formatMin(stats.light.meanMin)} sub={`${stats.light.meanPct.toFixed(0)}% of the night`} color={STAGE_COLOR.light} />
          <Kpi
            label="Nights with stages"
            value={`${result.nights.length}/${result.windowDays}`}
            sub={result.noStageNights > 0 ? `${result.noStageNights} with no stage data` : "Missing nights are skipped"}
          />
        </div>
        <p data-testid="stages-takeaway" style={{ margin: "16px 0 0", color: "var(--fg-2)", fontSize: 14 }}>
          <strong style={{ color: "var(--fg-1)" }}>Takeaway: </strong>
          {takeaway}
        </p>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: STAGE_COLOR.rem, color: STAGE_COLOR.rem }} />
              Stages per night
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              Each bar is one night · deep at the bottom, then REM, light and awake
            </div>
          </div>
        </div>
        <StageBarsChart nights={result.nights} start={result.start} windowDays={result.windowDays} />
        <Legend />
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: STAGE_COLOR.light, color: STAGE_COLOR.light }} />
            {`Stage averages · ${result.nights.length} nights`}
          </div>
        </div>
        <StatsTable stats={stats} />
      </div>

      <div className="grid-2col" style={{ marginTop: 24 }}>
        <RangeCard label="Deep" range={ranges.deep} latestDate={latest?.date ?? null} />
        <RangeCard label="REM" range={ranges.rem} latestDate={latest?.date ?? null} />
      </div>

      <div className="grid-2col" style={{ marginTop: 24 }}>
        <TrendCard label="Deep" trend={trends.deep} />
        <TrendCard label="REM" trend={trends.rem} />
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "var(--fg-3)", color: "var(--fg-3)" }} />
            How this is calculated
          </div>
        </div>
        <div className="card-sub" style={{ lineHeight: 1.6, fontSize: 12 }}>
          {`Stage minutes come from Whoop's light, deep, REM and awake durations for your main sleep each night (naps
          excluded). Nights missing any stage are left out and counted as "no stage data". Percentages are of the whole
          recorded night (all four stages), so they add up to 100%. Your typical range is the 25th–75th percentile of
          your own nights over the last ${HISTORY_DAYS} days, not counting the latest night, which is then marked below,
          within or above it. Trends compare the average of the last ${TREND_DAYS} days with the ${TREND_DAYS} before
          (each needs ${MIN_NIGHTS} nights); a change under ${STEADY_MIN} min is "steady", and the slope is a straight-line
          fit over the last ${TREND_DAYS} days. Durations are elapsed time, so DST nights are not distorted. Fewer than
          ${MIN_NIGHTS} nights in the window shows "not enough data".`}
        </div>
      </div>
    </>
  );
}
