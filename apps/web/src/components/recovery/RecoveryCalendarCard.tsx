import { bandColor, bandLabel, type Band } from "@/components/plans/band";
import {
  describeCalendar,
  type MonthSummary,
  type RecoveryCalendar,
  type Streak,
} from "@/lib/analytics/recoveryCalendar";

type Props = { calendar: RecoveryCalendar };

const CELL = 11;
const GAP = 3;
const EMPTY = "rgba(255,255,255,0.06)";
const BANDS: Band[] = ["low", "mid", "high"];

function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function streakText(s: Streak): string {
  if (s.length === 0 || !s.start || !s.end) return "0 days";
  const unit = s.length === 1 ? "day" : "days";
  return s.start === s.end
    ? `${s.length} ${unit} (${shortDate(s.start)})`
    : `${s.length} ${unit} (${shortDate(s.start)}–${shortDate(s.end)})`;
}

function monthText(m: MonthSummary | null): string {
  return m ? `${m.label} · avg ${m.average}%` : "—";
}

// Server-rendered: no client JS. Hover tooltips come from each cell's `title`;
// screen readers get the grid's one-line accessible name plus the visually
// hidden monthly and daily tables below it, so nothing is conveyed by color alone.
export default function RecoveryCalendarCard({ calendar: cal }: Props) {
  const summary = describeCalendar(cal);
  const columns = cal.weeks.length;
  const gridWidth = columns * CELL + (columns - 1) * GAP;

  return (
    <div className="card" data-testid="recovery-calendar">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "var(--metric-recovery)", color: "var(--metric-recovery)" }} />
            Recovery calendar
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>Last 12 months · daily recovery band</div>
        </div>
      </div>

      {cal.daysScored === 0 ? (
        <div className="empty-state">
          <div className="title">No scored recovery in the last 12 months</div>
          <div className="sub">Sync Whoop to fill in the calendar</div>
        </div>
      ) : (
        <>
          <div style={{ overflowX: "auto", paddingBottom: 6 }}>
            <div style={{ display: "flex", gap: 6, width: "max-content" }}>
              <div
                aria-hidden="true"
                style={{
                  display: "grid",
                  gridTemplateRows: `14px repeat(7, ${CELL}px)`,
                  rowGap: GAP,
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  color: "var(--fg-3)",
                  lineHeight: `${CELL}px`,
                }}
              >
                <span />
                {cal.weekdayLabels.map((d, i) => (
                  <span key={d}>{i % 2 === 0 ? d : ""}</span>
                ))}
              </div>
              <div>
                <div
                  aria-hidden="true"
                  style={{ position: "relative", height: 14, marginBottom: GAP, width: gridWidth }}
                >
                  {cal.monthLabels.map((m) => (
                    <span
                      key={`${m.column}-${m.label}`}
                      style={{
                        position: "absolute",
                        left: m.column * (CELL + GAP),
                        fontFamily: "var(--font-mono)",
                        fontSize: 9,
                        color: "var(--fg-3)",
                      }}
                    >
                      {m.label}
                    </span>
                  ))}
                </div>
                <div
                  role="img"
                  aria-label={summary}
                  data-testid="recovery-calendar-grid"
                  style={{
                    display: "grid",
                    gridAutoFlow: "column",
                    gridTemplateRows: `repeat(7, ${CELL}px)`,
                    gridAutoColumns: `${CELL}px`,
                    gap: GAP,
                  }}
                >
                  {cal.weeks.flat().map((c) => (
                    <span
                      key={c.date}
                      title={c.inWindow ? c.label : undefined}
                      data-date={c.date}
                      data-band={c.band ?? (c.inWindow ? "none" : "outside")}
                      style={{
                        width: CELL,
                        height: CELL,
                        borderRadius: 2,
                        background: !c.inWindow ? "transparent" : c.band ? bandColor(c.band) : EMPTY,
                        outline: c.date === cal.today ? "1px solid var(--fg-2)" : undefined,
                        outlineOffset: 1,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 12,
              marginTop: 10,
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--fg-3)",
            }}
            data-testid="recovery-calendar-legend"
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span aria-hidden="true" style={{ width: CELL, height: CELL, borderRadius: 2, background: EMPTY }} />
              No data
            </span>
            {BANDS.map((b) => (
              <span key={b} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span aria-hidden="true" style={{ width: CELL, height: CELL, borderRadius: 2, background: bandColor(b) }} />
                {bandLabel(b)} {b === "high" ? "≥67%" : b === "mid" ? "34–66%" : "<34%"} · {cal.bandCounts[b]}
              </span>
            ))}
          </div>

          <dl
            data-testid="recovery-calendar-stats"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "10px 16px",
              marginTop: 14,
              marginBottom: 0,
            }}
          >
            {[
              ["Current green streak", streakText(cal.currentGreenStreak)],
              ["Longest green streak", streakText(cal.longestGreenStreak)],
              ["Best month", monthText(cal.bestMonth)],
              ["Worst month", monthText(cal.worstMonth)],
              ["Days scored", `${cal.daysScored} of ${cal.daysInWindow} (${cal.coveragePct}%)`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="card-sub">{k}</dt>
                <dd style={{ margin: "3px 0 0", fontSize: 13, color: "var(--fg-1)" }}>{v}</dd>
              </div>
            ))}
          </dl>

          <div className="sr-only">
            <table data-testid="recovery-calendar-months">
              <caption>Recovery by month, last 12 months</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Days scored</th>
                  <th scope="col">Average recovery (%)</th>
                  <th scope="col">High days</th>
                  <th scope="col">Mid days</th>
                  <th scope="col">Low days</th>
                </tr>
              </thead>
              <tbody>
                {cal.months.map((m) => (
                  <tr key={m.month}>
                    <th scope="row">{m.label}</th>
                    <td>{m.scored} of {m.daysInWindow}</td>
                    <td>{m.average ?? "no data"}</td>
                    <td>{m.high}</td>
                    <td>{m.mid}</td>
                    <td>{m.low}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table data-testid="recovery-calendar-days">
              <caption>Daily recovery, scored days only</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Recovery (%)</th>
                  <th scope="col">Band</th>
                  <th scope="col">HRV (ms)</th>
                  <th scope="col">RHR (bpm)</th>
                </tr>
              </thead>
              <tbody>
                {cal.scoredDays.map((c) => (
                  <tr key={c.date}>
                    <th scope="row">{c.date}</th>
                    <td>{c.score != null ? Math.round(c.score) : ""}</td>
                    <td>{c.band ? bandLabel(c.band) : ""}</td>
                    <td>{c.hrv != null ? Math.round(c.hrv) : "—"}</td>
                    <td>{c.rhr != null ? Math.round(c.rhr) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
