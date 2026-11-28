import Link from "next/link";
import {
  MIN_NIGHTS,
  MIN_SRI_PAIRS,
  REGULARITY_WINDOWS,
  formatClock,
  formatMinutes,
  type RegularityNight,
  type RegularityTone,
  type SleepRegularityResult,
  type TimingStats,
} from "@/lib/analytics/sleepRegularity";

const ACCENT = "#7b61ff";
const WEEKDAY = "#00aaff";
const WEEKEND = "#ffaa00";

export const TONE_COLOR: Record<RegularityTone, string> = {
  good: "#00d4aa",
  ok: "#00aaff",
  warn: "#ffaa00",
  bad: "#ff3b3b",
};

// Chart geometry: y is clock time from 18:00 (top) to 14:00 next day (bottom).
const CHART_W = 600;
const CHART_H = 240;
const PAD_L = 44;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 22;
const Y_START = 18; // 6pm
const Y_SPAN = 20; // through 2pm
const PLOT_H = CHART_H - PAD_T - PAD_B;
const PLOT_W = CHART_W - PAD_L - PAD_R;

/** Hours after 18:00 on the bed evening for a bedtime anchored at 20:00. */
function bedOffset(n: RegularityNight): number {
  return n.bedFromAnchor + 2;
}

export function yFor(hoursAfterSix: number): number {
  const clamped = Math.min(Math.max(hoursAfterSix, 0), Y_SPAN);
  return PAD_T + (clamped / Y_SPAN) * PLOT_H;
}

function dayIndex(start: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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
    <div style={{ display: "flex", gap: 6 }} data-testid="regularity-window">
      {REGULARITY_WINDOWS.map((w) => (
        <Link
          key={w}
          href={`/sleep/regularity?window=${w}`}
          aria-current={w === current ? "page" : undefined}
          className="card-sub"
          style={{
            padding: "4px 10px",
            borderRadius: 999,
            border: "1px solid var(--line, rgba(255,255,255,0.12))",
            color: w === current ? "var(--fg-1)" : "var(--fg-3)",
            background: w === current ? "rgba(123,97,255,0.18)" : "transparent",
            textDecoration: "none",
          }}
        >
          {`${w} days`}
        </Link>
      ))}
    </div>
  );
}

function TimingCard({ title, stats, color }: { title: string; stats: TimingStats; color: string }) {
  const rows: [string, string][] = [
    ["Median", formatClock(stats.median)],
    ["Variability (SD)", `± ${formatMinutes(stats.sdMin)}`],
    ["Earliest", `${formatClock(stats.earliest.hour)} · ${shortDate(stats.earliest.date)}`],
    ["Latest", `${formatClock(stats.latest.hour)} · ${shortDate(stats.latest.date)}`],
  ];
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">
          <span className="dot" style={{ background: color, color }} />
          {title}
        </div>
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

export function NightRangeChart({
  nights,
  start,
  windowDays,
  medianBed,
  medianWake,
}: {
  nights: readonly RegularityNight[];
  start: string;
  windowDays: number;
  medianBed?: number;
  medianWake?: number;
}) {
  const slot = PLOT_W / windowDays;
  const barW = Math.max(3, Math.min(18, slot * 0.6));
  const ticks = [0, 4, 8, 12, 16, 20]; // 6pm, 10pm, 2am, 6am, 10am, 2pm
  const medianLine = (clock: number | undefined, key: string) => {
    if (clock == null) return null;
    // Map a clock hour onto the 18:00-based axis.
    const off = (clock - Y_START + 24) % 24;
    const yy = yFor(off);
    return (
      <line
        key={key}
        data-testid={`median-${key}`}
        x1={PAD_L}
        x2={CHART_W - PAD_R}
        y1={yy}
        y2={yy}
        stroke="rgba(255,255,255,0.35)"
        strokeDasharray="4 4"
        strokeWidth="1"
      />
    );
  };
  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      role="img"
      aria-label={`In-bed window for each of ${nights.length} nights over the last ${windowDays} days`}
      style={{ width: "100%", height: "auto", display: "block" }}
      data-testid="regularity-chart"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD_L}
            x2={CHART_W - PAD_R}
            y1={yFor(t)}
            y2={yFor(t)}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
          />
          <text
            x={PAD_L - 6}
            y={yFor(t) + 3}
            textAnchor="end"
            fontSize="10"
            fontFamily="var(--font-mono)"
            fill="var(--fg-3)"
          >
            {formatClock(Y_START + t).replace(":00", "")}
          </text>
        </g>
      ))}
      {medianLine(medianBed, "bed")}
      {medianLine(medianWake, "wake")}
      {nights.map((n) => {
        const i = dayIndex(start, n.date);
        const x = PAD_L + slot * (i + 0.5) - barW / 2;
        const y1 = yFor(bedOffset(n));
        const y2 = yFor(bedOffset(n) + n.hours);
        return (
          <rect
            key={n.date}
            data-night={n.date}
            data-weekend={n.weekend ? "1" : "0"}
            x={x.toFixed(1)}
            y={y1.toFixed(1)}
            width={barW.toFixed(1)}
            height={Math.max(1, y2 - y1).toFixed(1)}
            rx={Math.min(4, barW / 2)}
            fill={n.weekend ? WEEKEND : WEEKDAY}
            opacity="0.85"
          >
            <title>{`${shortDate(n.date)}: ${formatClock(n.bedFromAnchor + 20)} → ${formatClock(n.wakeFromAnchor)} (${n.hours.toFixed(1)}h)`}</title>
          </rect>
        );
      })}
      {[0, Math.floor(windowDays / 2), windowDays - 1].map((i) => {
        const d = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
        return (
          <text
            key={i}
            x={PAD_L + slot * (i + 0.5)}
            y={CHART_H - 6}
            textAnchor="middle"
            fontSize="10"
            fontFamily="var(--font-mono)"
            fill="var(--fg-3)"
          >
            {i === windowDays - 1 ? "Today" : shortDate(d)}
          </text>
        );
      })}
    </svg>
  );
}

function Legend() {
  const item = (color: string, label: string, dashed = false) => (
    <span className="card-sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: dashed ? 14 : 8,
          height: dashed ? 0 : 8,
          borderRadius: 2,
          background: dashed ? "transparent" : color,
          borderTop: dashed ? `1px dashed ${color}` : undefined,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
      {item(WEEKDAY, "Weekday night")}
      {item(WEEKEND, "Weekend night (wake Sat/Sun)")}
      {item("rgba(255,255,255,0.6)", "Median bedtime / wake", true)}
    </div>
  );
}

export default function SleepRegularityView({ result }: { result: SleepRegularityResult }) {
  const header = (
    <div className="card-head" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
      <div>
        <div className="card-title">
          <span className="dot" style={{ background: ACCENT, color: ACCENT }} />
          Sleep Regularity
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
      <div className="card" data-testid="regularity-hero">
        {header}
        <div className="empty-state" data-testid="regularity-insufficient">
          <div className="title">Not enough data yet</div>
          <div className="sub">
            {`Regularity needs at least ${MIN_NIGHTS} recorded nights in the last ${result.windowDays} days — ${result.nights.length} so far.`}
          </div>
        </div>
      </div>
    );
  }

  const { sri, matchPct, sriPairs, bedtime, wake, socialJetlag, rating, tip } = result;
  const toneColor = TONE_COLOR[rating.tone];

  return (
    <>
      <div className="card" data-testid="regularity-hero">
        {header}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <Kpi
            label="Sleep Regularity Index"
            value={sri == null ? "—" : Math.round(sri).toString()}
            sub={
              sri == null
                ? `Needs ${MIN_SRI_PAIRS} back-to-back nights (${sriPairs} so far)`
                : `${Math.round(matchPct!)}% same state 24h later · ${sriPairs} night pairs`
            }
            color={sri == null ? undefined : toneColor}
          />
          <Kpi label="Rating" value={rating.label} sub={rating.basis === "sri" ? "From SRI" : "From bed/wake variability"} color={toneColor} />
          <Kpi
            label="Social jetlag"
            value={socialJetlag ? formatMinutes(socialJetlag.minutes) : "—"}
            sub={
              socialJetlag
                ? `Weekend mid-sleep ${formatClock(socialJetlag.weekendMid)} vs weekday ${formatClock(socialJetlag.weekdayMid)}`
                : "Needs both weekday and weekend nights"
            }
          />
          <Kpi label="Nights recorded" value={`${result.nights.length}/${result.windowDays}`} sub="Missing nights are skipped, not scored" />
        </div>
        <p data-testid="regularity-tip" style={{ margin: "16px 0 0", color: "var(--fg-2)", fontSize: 14 }}>
          <strong style={{ color: "var(--fg-1)" }}>Tip: </strong>
          {tip}
        </p>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: WEEKDAY, color: WEEKDAY }} />
              Bedtime → wake, per night
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              Each bar is one night&apos;s in-bed window · steadier bars = higher regularity
            </div>
          </div>
        </div>
        <NightRangeChart
          nights={result.nights}
          start={result.start}
          windowDays={result.windowDays}
          medianBed={bedtime.median}
          medianWake={wake.median}
        />
        <Legend />
      </div>

      <div className="grid-2col" style={{ marginTop: 24 }}>
        <TimingCard title="Bedtime consistency" stats={bedtime} color={WEEKDAY} />
        <TimingCard title="Wake-time consistency" stats={wake} color="#00d4aa" />
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "var(--fg-3)", color: "var(--fg-3)" }} />
            How this is calculated
          </div>
        </div>
        <div className="card-sub" style={{ lineHeight: 1.6, fontSize: 12 }}>
          SRI (Phillips et al., 2017) = 200 × P(match) − 100, where P(match) is the share of 5-minute clock
          slots whose sleep/wake state is the same 24 hours later, compared only across back-to-back nights that
          both have data. 100 is a perfectly repeating schedule; 0 is chance. &quot;Asleep&quot; is Whoop&apos;s
          in-bed window, so brief wakes count as sleep. Social jetlag is the gap between average mid-sleep on
          weekend nights (waking Sat/Sun) and weekday nights. All times are local clock time (a DST night is measured
          on the clock, so it reads an hour longer or shorter). Fewer than 7 nights shows &quot;not enough data&quot;.
        </div>
      </div>
    </>
  );
}
