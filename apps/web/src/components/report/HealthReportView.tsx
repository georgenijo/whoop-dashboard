import Link from "next/link";
import {
  REPORT_DAY_OPTIONS,
  formatDuration,
  formatReportDate,
  type HealthReport,
  type MetricLine,
  type NotableDay,
} from "@/lib/analytics/healthReport";
import PrintButton from "./PrintButton";

function fmt(v: number, decimals: number): string {
  return v.toFixed(decimals);
}

function withUnit(v: number, m: Pick<MetricLine, "unit" | "decimals">): string {
  const n = fmt(v, m.decimals);
  if (!m.unit) return n;
  return m.unit === "%" || m.unit === "°C" ? `${n}${m.unit}` : `${n} ${m.unit}`;
}

function MetricRow({ m }: { m: MetricLine }) {
  const s = m.stat;
  return (
    <tr data-testid={`hr-metric-${m.key}`}>
      <th scope="row">{m.label}</th>
      {s ? (
        <>
          <td className="num">{withUnit(s.avg, m)}</td>
          <td className="num">
            {withUnit(s.min, m)}
            <span className="hr-when">{formatReportDate(s.minDate)}</span>
          </td>
          <td className="num">
            {withUnit(s.max, m)}
            <span className="hr-when">{formatReportDate(s.maxDate)}</span>
          </td>
          <td className="num">{s.n}</td>
        </>
      ) : (
        <td colSpan={4} className="hr-none">
          No data
        </td>
      )}
    </tr>
  );
}

function Notable({ label, day, render }: { label: string; day: NotableDay | null; render: (v: number) => string }) {
  return (
    <div className="hr-notable">
      <dt>{label}</dt>
      <dd>{day ? `${render(day.value)} · ${formatReportDate(day.date)}` : "—"}</dd>
    </div>
  );
}

export default function HealthReportView({ report }: { report: HealthReport }) {
  const { coverage: c } = report;
  const range = `${formatReportDate(report.start, true)} – ${formatReportDate(report.end, true)}`;
  const visible = report.metrics.filter((m) => m.key !== "skinTemp" || m.stat !== null);
  const dev = report.skinTempMaxDeviation;

  return (
    <article className="hr-report" data-testid="health-report">
      <header className="hr-head">
        <div>
          <h1 className="hr-title">Health summary · last {report.days} days</h1>
          <p className="hr-range" data-testid="hr-range">{range}</p>
        </div>
        <div className="hr-actions hr-no-print" data-testid="hr-actions">
          <nav className="hr-days" aria-label="Report period">
            {REPORT_DAY_OPTIONS.map((d) => (
              <Link
                key={d}
                href={`/report?days=${d}`}
                className={`hr-day ${d === report.days ? "active" : ""}`}
                aria-current={d === report.days ? "page" : undefined}
              >
                {d} days
              </Link>
            ))}
          </nav>
          <PrintButton />
        </div>
      </header>

      <p className="hr-coverage" data-testid="hr-coverage">
        Data coverage: <strong>{c.recoveryDays}/{c.days}</strong> days scored recovery ·{" "}
        <strong>{c.sleepNights}/{c.days}</strong> nights of sleep ·{" "}
        <strong>{c.strainDays}/{c.days}</strong> days of strain
      </p>

      {report.empty ? (
        <p className="hr-empty" data-testid="hr-empty">
          No Whoop data was recorded in this period.
        </p>
      ) : (
        <>
          <section className="hr-section">
            <h2>Daily metrics</h2>
            <table className="hr-table">
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col" className="num">Average</th>
                  <th scope="col" className="num">Min</th>
                  <th scope="col" className="num">Max</th>
                  <th scope="col" className="num">Days</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((m) => (
                  <MetricRow key={m.key} m={m} />
                ))}
              </tbody>
            </table>
            {dev && (
              <p className="hr-note" data-testid="hr-skin-dev">
                Largest skin-temperature deviation from this period&rsquo;s average:{" "}
                {dev.value >= 0 ? "+" : "−"}
                {Math.abs(dev.value).toFixed(1)}°C on {formatReportDate(dev.date)}.
              </p>
            )}
          </section>

          <div className="hr-grid">
            <section className="hr-section">
              <h2>Workouts</h2>
              <dl className="hr-dl" data-testid="hr-workouts">
                <div className="hr-notable">
                  <dt>Workouts</dt>
                  <dd>{report.workouts.count}</dd>
                </div>
                <div className="hr-notable">
                  <dt>Total time</dt>
                  <dd>{formatDuration(report.workouts.totalSec)}</dd>
                </div>
              </dl>
            </section>
            <section className="hr-section">
              <h2>Notable days</h2>
              <dl className="hr-dl" data-testid="hr-notable">
                <Notable label="Best recovery" day={report.notable.bestRecovery} render={(v) => `${v.toFixed(0)}%`} />
                <Notable label="Worst recovery" day={report.notable.worstRecovery} render={(v) => `${v.toFixed(0)}%`} />
                <Notable label="Longest sleep" day={report.notable.longestSleep} render={(v) => `${v.toFixed(1)} h`} />
              </dl>
            </section>
          </div>
        </>
      )}

      <footer className="hr-foot">
        Summarized from Whoop data. Averages cover days with a recorded value only. Sleep duration
        is time asleep (light + deep + REM) for the main sleep, excluding naps. This is not medical advice.
      </footer>
    </article>
  );
}
