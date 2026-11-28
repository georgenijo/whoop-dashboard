import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthOrSignin } from "@/lib/auth";
import {
  getRecoveryRange,
  getSleepRange,
  getStrainRange,
  getUserSettings,
  getWorkoutRowsRange,
} from "@/lib/db";
import {
  MIN_MONTH_DAYS,
  MIN_REVIEW_YEAR,
  buildYearReview,
  parseReviewYear,
  shortDate,
  yearBounds,
  type DatedValue,
  type MonthStat,
  type YearReview,
} from "@/lib/analytics/yearReview";
import { parseDate } from "@/lib/whoop/upsert";
import { yearReviewEnabled } from "@/lib/year-review-flag";
import styles from "./year.module.css";

export const dynamic = "force-dynamic";

const GREEN = "#00d4aa";
const YELLOW = "#ffde00";
const RED = "#ff0026";
const ZONE_COLORS = ["#5ac8fa", "#00d4aa", "#ffde00", "#ffaa00", "#ff3b5c"];

function zoneColor(score: number): string {
  if (score >= 67) return GREEN;
  if (score >= 34) return YELLOW;
  return RED;
}

function fmt(v: number | null, dp = 0, unit = ""): string {
  if (v == null) return "—";
  return `${v.toFixed(dp)}${unit}`;
}

function fmtHours(h: number | null): string {
  if (h == null) return "—";
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function YearNav({ year, currentYear }: { year: number; currentYear: number }) {
  return (
    <nav className={styles.yearNav} aria-label="Choose year">
      {year > MIN_REVIEW_YEAR ? (
        <Link href={`/year?y=${year - 1}`} aria-label={`Previous year, ${year - 1}`}>
          ← {year - 1}
        </Link>
      ) : (
        <span aria-hidden />
      )}
      <span className={styles.yearNavCurrent} aria-current="page">
        {year}
      </span>
      {year < currentYear ? (
        <Link href={`/year?y=${year + 1}`} aria-label={`Next year, ${year + 1}`}>
          {year + 1} →
        </Link>
      ) : (
        <span aria-hidden />
      )}
    </nav>
  );
}

function MonthRow({ m }: { m: MonthStat }) {
  const score = m.recovery;
  return (
    <div className={styles.monthRow}>
      <span className={styles.monthName}>
        {m.label.slice(0, 3)}
        {m.partial ? "*" : ""}
      </span>
      <span className={styles.track} aria-hidden>
        {score != null && (
          <span style={{ width: `${Math.max(2, Math.min(100, score))}%`, background: zoneColor(score) }} />
        )}
      </span>
      <span className={styles.monthVal}>{fmt(score, 0, "%")}</span>
      <span className={styles.monthMeta}>
        {fmt(m.hrv, 0, " ms")} · {fmt(m.rhr, 0, " bpm")} · {fmtHours(m.sleepHours)}
        <span className={styles.monthDays}> · {m.scoredDays}d</span>
      </span>
    </div>
  );
}

function Stat({ lbl, val, sub }: { lbl: string; val: string; sub?: string | null }) {
  return (
    <div className="record-card">
      <div className="rc-lbl">{lbl}</div>
      <div className="rc-val tnum">{val}</div>
      <div className="rc-meta">{sub ?? "No data"}</div>
    </div>
  );
}

const on = (v: DatedValue | null) => (v ? shortDate(v.date) : null);

function Review({ r }: { r: YearReview }) {
  const sportMax = Math.max(1, ...r.workouts.topSports.map((s) => s.count));
  const zoneMax = Math.max(1, ...r.workouts.zoneMinutes);
  const consistencyMonths = r.months.filter((m) => m.consistency != null);

  return (
    <>
      <section aria-label="Year totals">
        <div className="totals-strip">
          <div className="total-cell">
            <span className="lbl">Days scored</span>
            <span className="val tnum">
              {fmtInt(r.daysScored)}
              <span className="u">/ {r.daysElapsed}</span>
            </span>
          </div>
          <div className="total-cell">
            <span className="lbl">Avg recovery</span>
            <span className="val tnum">{fmt(r.averages.recovery, 0, "%")}</span>
          </div>
          <div className="total-cell">
            <span className="lbl">Avg HRV · RHR</span>
            <span className="val tnum">
              {fmt(r.averages.hrv)}
              {r.averages.hrv != null && <span className="u">ms</span>} {fmt(r.averages.rhr)}
              {r.averages.rhr != null && <span className="u">bpm</span>}
            </span>
          </div>
          <div className="total-cell">
            <span className="lbl">Avg sleep</span>
            <span className="val tnum">{fmtHours(r.averages.sleepHours)}</span>
          </div>
        </div>
      </section>

      {r.highlights.length > 0 && (
        <section className="card" aria-label="Highlights">
          <div className="card-head">
            <div className="card-title">
              <span className="dot" style={{ background: GREEN, color: GREEN }} />
              Highlights
            </div>
          </div>
          <ul className={styles.highlights}>
            {r.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Standouts">
        <div className="stats-microlabel">Standouts</div>
        <div className="record-grid">
          <Stat
            lbl="Best month"
            val={r.bestMonth ? r.bestMonth.label : "—"}
            sub={r.bestMonth ? `${fmt(r.bestMonth.recovery, 0, "%")} avg recovery` : `Needs ${MIN_MONTH_DAYS}+ scored days in a month`}
          />
          <Stat
            lbl="Toughest month"
            val={r.worstMonth ? r.worstMonth.label : "—"}
            sub={r.worstMonth ? `${fmt(r.worstMonth.recovery, 0, "%")} avg recovery` : "Needs two ranked months"}
          />
          <Stat
            lbl="Longest green streak"
            val={r.greenStreak ? `${r.greenStreak.days}d` : "—"}
            sub={
              r.greenStreak
                ? `${shortDate(r.greenStreak.start)} – ${shortDate(r.greenStreak.end)} · ${r.greenDays} green days total`
                : "No green days yet"
            }
          />
          <Stat
            lbl="Highest strain day"
            val={fmt(r.highestStrainDay?.value ?? null, 1)}
            sub={on(r.highestStrainDay)}
          />
          <Stat lbl="Avg day strain" val={fmt(r.averages.strain, 1)} sub={`${r.year} daily average`} />
          <Stat
            lbl="Workouts"
            val={fmtInt(r.workouts.count)}
            sub={`${fmtInt(r.workouts.minutes / 60)} h total`}
          />
        </div>
      </section>

      <section className="card" aria-label="Month by month">
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
              Month by month
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              avg recovery · HRV · RHR · sleep · scored days
            </div>
          </div>
        </div>
        <div className={styles.monthList}>
          {r.months.map((m) => (
            <MonthRow key={m.month} m={m} />
          ))}
        </div>
        {r.months.some((m) => m.partial) && <div className={styles.footnote}>* month in progress</div>}
      </section>

      <div className={styles.twoUp}>
        <section className="card" aria-label="Training">
          <div className="card-head">
            <div className="card-title">
              <span className="dot" style={{ background: "#ffaa00", color: "#ffaa00" }} />
              Training
            </div>
            <span className="card-sub">
              {fmtInt(r.workouts.count)} sessions · {fmtInt(r.workouts.minutes / 60)} h
            </span>
          </div>
          {r.workouts.count === 0 ? (
            <div className="empty-state">
              <div className="sub">No workouts logged in {r.year}.</div>
            </div>
          ) : (
            <>
              <div className="stats-microlabel">Top sports</div>
              <div className="sport-list">
                {r.workouts.topSports.map((s) => (
                  <div className="sport-row" key={s.sport}>
                    <span className="name">{s.sport}</span>
                    <span className="track">
                      <span style={{ width: `${(s.count / sportMax) * 100}%`, background: "#ffaa00" }} />
                    </span>
                    <span className="n">{s.count}</span>
                  </div>
                ))}
              </div>
              <div className="stats-microlabel" style={{ marginTop: 16 }}>
                HR zone minutes
              </div>
              <div className="sport-list">
                {r.workouts.zoneMinutes.map((z, i) => (
                  <div className="sport-row" key={i}>
                    <span className="name">Zone {i + 1}</span>
                    <span className="track">
                      <span style={{ width: `${(z / zoneMax) * 100}%`, background: ZONE_COLORS[i] }} />
                    </span>
                    <span className="n">{fmtInt(z)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="card" aria-label="Sleep consistency">
          <div className="card-head">
            <div className="card-title">
              <span className="dot" style={{ background: "#5ac8fa", color: "#5ac8fa" }} />
              Sleep consistency
            </div>
            <span className="card-sub">
              {r.consistencyTrend
                ? `${r.consistencyTrend.delta >= 0 ? "+" : "−"}${Math.abs(Math.round(r.consistencyTrend.delta))} pts ${r.consistencyTrend.from.label.slice(0, 3)} → ${r.consistencyTrend.to.label.slice(0, 3)}`
                : "not enough nights for a trend"}
            </span>
          </div>
          {consistencyMonths.length === 0 ? (
            <div className="empty-state">
              <div className="sub">No sleep consistency scores in {r.year}.</div>
            </div>
          ) : (
            <div className={styles.columns} role="img" aria-label="Average sleep consistency by month">
              {r.months.map((m) => (
                <div className={styles.column} key={m.month} title={`${m.label}: ${fmt(m.consistency, 0, "%")}`}>
                  <span className={styles.columnVal}>{m.consistency != null ? Math.round(m.consistency) : ""}</span>
                  <span className={styles.columnBar}>
                    {m.consistency != null && <span style={{ height: `${Math.max(2, Math.min(100, m.consistency))}%` }} />}
                  </span>
                  <span className={styles.columnLbl}>{m.label.slice(0, 1)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section aria-label="Personal bests">
        <div className="stats-microlabel">Personal bests · {r.year}</div>
        <div className="record-grid">
          <Stat lbl="Highest HRV" val={fmt(r.personalBests.highestHrv?.value ?? null, 0, " ms")} sub={on(r.personalBests.highestHrv)} />
          <Stat lbl="Lowest RHR" val={fmt(r.personalBests.lowestRhr?.value ?? null, 0, " bpm")} sub={on(r.personalBests.lowestRhr)} />
          <Stat
            lbl="Longest sleep"
            val={fmtHours(r.personalBests.longestSleepHours?.value ?? null)}
            sub={on(r.personalBests.longestSleepHours)}
          />
        </div>
      </section>
    </>
  );
}

export default async function YearReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string | string[] }>;
}) {
  // Flag check first: with YEAR_REVIEW unset the route is a 404 and does no
  // auth-dependent or DB work beyond what the dashboard layout already did.
  if (!yearReviewEnabled()) notFound();

  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const { y } = await searchParams;

  const tz = getUserSettings(user.id)?.tz ?? "UTC";
  const today = parseDate(new Date().toISOString(), tz);
  const currentYear = Number(today.slice(0, 4));
  const year = parseReviewYear(y, currentYear);
  const { start, end } = yearBounds(year, today);

  const review = buildYearReview(year, today, {
    recovery: getRecoveryRange(user.id, start, end),
    sleep: getSleepRange(user.id, start, end),
    cycles: getStrainRange(user.id, start, end),
    workouts: getWorkoutRowsRange(user.id, start, end),
  });

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <div className="stats-microlabel">Year in review</div>
          <h1 className={styles.title}>{year}</h1>
          <div className="card-sub">
            {shortDate(start)} – {shortDate(end)}, {year}
            {review.isCurrentYear ? " · so far" : ""} · {review.daysInYear}-day year
          </div>
        </div>
        <YearNav year={year} currentYear={currentYear} />
      </header>

      {review.hasData ? (
        <Review r={review} />
      ) : (
        <div className="card">
          <div className="empty-state">
            <div className="title">Nothing recorded in {year}</div>
            <div className="sub">
              Once Whoop has scored some days this year, your review fills in here. Try another year with the
              arrows above.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
