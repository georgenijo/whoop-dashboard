import Link from "next/link";
import WorkoutCalendarGrid, { BAND_TINT } from "@/components/workouts/WorkoutCalendarGrid";
import {
  BAND_LABEL,
  shortDayLabel,
  type StrainBand,
  type WorkoutCalendarMonth,
} from "@/lib/analytics/workoutCalendar";

const ACCENT = "#ffaa00";
const BANDS: StrainBand[] = ["light", "moderate", "high", "allout"];
const BAND_RANGE: Record<StrainBand, string> = {
  light: "< 10",
  moderate: "10–14",
  high: "14–18",
  allout: "18+",
};

function Stat({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId: string }) {
  return (
    <div className="card" style={{ padding: 14 }} data-testid={testId}>
      <div className="card-sub">{label}</div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 24,
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
          color: "var(--fg-1)",
          margin: "4px 0 2px",
        }}
      >
        {value}
      </div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  );
}

function days(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

function MonthNav({ cal }: { cal: WorkoutCalendarMonth }) {
  const pill = {
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    color: "var(--fg-1)",
    textDecoration: "none",
  } as const;
  return (
    <nav aria-label="Month" style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {cal.prevMonth ? (
        <Link href={`/workouts/calendar?month=${cal.prevMonth}`} className="card-sub" style={pill} rel="prev" data-testid="wcal-prev">
          ← Prev
        </Link>
      ) : (
        <span className="card-sub" style={{ ...pill, color: "var(--fg-4)" }} aria-disabled="true">← Prev</span>
      )}
      {cal.nextMonth ? (
        <Link href={`/workouts/calendar?month=${cal.nextMonth}`} className="card-sub" style={pill} rel="next" data-testid="wcal-next">
          Next →
        </Link>
      ) : (
        <span className="card-sub" style={{ ...pill, color: "var(--fg-4)" }} aria-disabled="true">Next →</span>
      )}
    </nav>
  );
}

export default function WorkoutCalendarView({ cal }: { cal: WorkoutCalendarMonth }) {
  const s = cal.summary;
  const busiest = s.busiestDay;
  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head" style={{ flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 className="card-title" style={{ margin: 0 }} data-testid="wcal-title">
              <span className="dot" style={{ background: ACCENT, color: ACCENT }} />
              {cal.title}
            </h2>
            <div className="card-sub" style={{ marginTop: 4 }}>
              <Link href="/workouts" style={{ color: "inherit" }}>← Workouts</Link>
            </div>
          </div>
          <MonthNav cal={cal} />
        </div>

        {s.sessions === 0 ? (
          <p className="card-sub" style={{ margin: 0, fontSize: 13 }} data-testid="wcal-empty">
            No workouts logged in {cal.title}.
          </p>
        ) : (
          <div className="wcal-stats" data-testid="wcal-summary">
            <Stat testId="wcal-sessions" label="Sessions" value={String(s.sessions)} sub={`${days(s.trainingDays)} trained`} />
            <Stat testId="wcal-hours" label="Hours" value={s.hours.toFixed(1)} />
            <Stat testId="wcal-avg-strain" label="Avg strain" value={s.avgStrain != null ? s.avgStrain.toFixed(1) : "—"} sub="per session" />
            <Stat
              testId="wcal-busiest"
              label="Busiest day"
              value={busiest ? shortDayLabel(busiest.date) : "—"}
              sub={busiest ? `${busiest.minutes} min · ${busiest.sessions} session${busiest.sessions === 1 ? "" : "s"}` : undefined}
            />
            <Stat testId="wcal-rest" label="Rest days" value={String(s.restDays)} sub={`of ${days(s.elapsedDays)}`} />
            <Stat testId="wcal-streak" label="Longest streak" value={days(s.longestStreak)} sub="consecutive training" />
            <Stat testId="wcal-gap" label="Longest rest gap" value={days(s.longestRestGap)} />
          </div>
        )}
      </div>

      <div className="card">
        <WorkoutCalendarGrid weeks={cal.weeks} />
        <div className="wcal-legend" data-testid="wcal-legend">
          <span className="card-sub">Peak session strain:</span>
          {BANDS.map((b) => (
            <span key={b} className="card-sub wcal-legend-item">
              <span className="wcal-swatch" style={{ background: BAND_TINT[b] }} aria-hidden="true" />
              {BAND_LABEL[b]} ({BAND_RANGE[b]})
            </span>
          ))}
        </div>
        <p className="card-sub" style={{ margin: "8px 0 0" }}>
          Workouts count on the day they started. Arrow keys move between days; Enter opens a
          workout, or lists the day&apos;s sessions when there are several.
        </p>
      </div>
    </>
  );
}
