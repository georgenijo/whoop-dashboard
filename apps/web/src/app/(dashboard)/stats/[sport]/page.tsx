import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthOrSignin } from "@/lib/auth";
import { capWorkoutRows, getMonthlyRollup, getWorkoutRowsRange } from "@/lib/db";
import { localToday } from "@/lib/date";
import { sportColor } from "@/lib/sport-color";
import {
  STATS_RANGE_KEYS,
  resolveStatsRange,
  sportFromParam,
  statsRangePillLabel,
  summarizeSportSessions,
} from "@/lib/stats-range";
import MonthlyTrendChart from "@/components/stats/MonthlyTrendChart";
import WorkoutsTable from "@/components/workouts/WorkoutsTable";

export const dynamic = "force-dynamic";

// Screen C (issue #430): every session of one sport plus its monthly strain and
// avg-HR trends. Reached from the "By sport" rows on /stats, which pass their
// `?range=` through so the drill-down opens on the same window. Data comes from
// the same Stats aggregations (`getWorkoutRowsRange`, `getMonthlyRollup`) with
// their sport filter — no separate query path.

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

const ChevronLeft = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export default async function SportStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const [{ sport: rawSport }, { range: rawRange }] = await Promise.all([params, searchParams]);
  const sport = sportFromParam(rawSport);
  if (!sport) notFound();

  const today = localToday();
  const year = new Date().getFullYear();
  const sel = resolveStatsRange(rawRange, year, today);

  const sessionRows = getWorkoutRowsRange(user.id, sel.start, sel.end, sport);
  const months = getMonthlyRollup(user.id, sel.start, sel.end, sport);
  const table = capWorkoutRows(sessionRows);
  const summary = summarizeSportSessions(sessionRows);
  const color = sportColor(sport === "Unknown" ? null : sport);

  const totals = [
    { lbl: "Sessions", val: fmtInt(summary.sessions), u: "" },
    {
      lbl: "Active time",
      val: summary.activeSeconds != null ? (summary.activeSeconds / 3600).toFixed(1) : "—",
      u: summary.activeSeconds != null ? "h" : "",
    },
    {
      lbl: "Avg strain",
      val: summary.avgStrain != null ? summary.avgStrain.toFixed(1) : "—",
      u: "",
    },
    {
      lbl: "Avg HR",
      val: summary.avgHr != null ? fmtInt(summary.avgHr) : "—",
      u: summary.avgHr != null ? "bpm" : "",
    },
  ];

  const sessionWord = (n: number) => (n === 1 ? "session" : "sessions");
  const backHref = sel.range === "year" ? "/stats" : `/stats?range=${sel.range}`;

  return (
    <>
      <div className="sport-head">
        <div>
          <Link href={backHref} className="sport-crumb">
            {ChevronLeft}
            Stats
          </Link>
          <h1>
            <i style={{ background: color }} />
            {sport}
          </h1>
        </div>
        <div className="range" role="tablist" aria-label="Time range">
          {STATS_RANGE_KEYS.map((k) => (
            <Link
              key={k}
              href={`?range=${k}`}
              role="tab"
              aria-selected={sel.range === k}
              className={sel.range === k ? "active" : ""}
            >
              {statsRangePillLabel(k, year)}
            </Link>
          ))}
        </div>
      </div>

      {summary.sessions === 0 ? (
        <section className="card">
          <div className="empty-state" data-testid="sport-empty">
            <div className="title">
              No {sport} sessions in {sel.range === "all" ? "your history" : sel.label.toLowerCase()}
            </div>
            <div className="sub">
              {sel.range === "all" ? (
                <>
                  Nothing logged under this sport. <Link href="/stats">Back to Stats</Link>
                </>
              ) : (
                <>
                  Try a wider window — <Link href="?range=all">view all-time</Link>
                </>
              )}
            </div>
          </div>
        </section>
      ) : (
        <>
          <section>
            <div className="stats-microlabel">{sel.label}</div>
            <div className="totals-strip">
              {totals.map((t) => (
                <div className="total-cell" key={t.lbl}>
                  <span className="lbl">{t.lbl}</span>
                  <span className="val tnum">
                    {t.val}
                    {t.u && <span className="u">{t.u}</span>}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <div className="grid-main">
            <div className="col">
              <section className="card">
                <div className="card-head">
                  <div>
                    <div className="card-title">
                      <span className="dot" style={{ background: "#ffaa00", color: "#ffaa00" }} />
                      Strain over time
                    </div>
                    <div className="card-sub" style={{ marginTop: 4 }}>
                      monthly · sessions vs avg strain
                    </div>
                  </div>
                  <div className="trend-legend">
                    <span className="tl">
                      <i style={{ background: color }} />
                      Sessions
                    </span>
                    <span className="tl">
                      <i style={{ background: "#ffaa00" }} />
                      Avg strain
                    </span>
                  </div>
                </div>
                <div className="trend-svg-wrap">
                  <MonthlyTrendChart months={months} line="avgStrain" barColor={color} lineColor="#ffaa00" />
                </div>
              </section>
            </div>
            <div className="col">
              <section className="card">
                <div className="card-head">
                  <div>
                    <div className="card-title">
                      <span className="dot" style={{ background: "#ff6b6b", color: "#ff6b6b" }} />
                      Avg heart rate
                    </div>
                    <div className="card-sub" style={{ marginTop: 4 }}>
                      monthly mean of session avg HR · bpm
                    </div>
                  </div>
                </div>
                <div className="trend-svg-wrap">
                  {months.some((m) => m.avgHr != null) ? (
                    <MonthlyTrendChart
                      months={months}
                      line="avgHr"
                      barColor="rgba(255,255,255,0.08)"
                      lineColor="#ff6b6b"
                      formatLineValue={(v) => String(Math.round(v))}
                    />
                  ) : (
                    <div className="empty-state">
                      <div className="sub">No heart-rate data for these sessions.</div>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>

          <WorkoutsTable
            rows={table.rows}
            title={`${sport} sessions`}
            countLabel={
              table.truncated
                ? `latest ${table.rows.length} of ${table.total_count} ${sessionWord(table.total_count)}`
                : `${table.total_count} ${sessionWord(table.total_count)}`
            }
          />
        </>
      )}
    </>
  );
}
