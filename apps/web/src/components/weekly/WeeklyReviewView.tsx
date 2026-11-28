import type { MetricComparison, WeeklyReview } from "@/lib/analytics/weekly";
import { MIN_SCORED_DAYS, formatDay } from "@/lib/analytics/weekly";
import PrintButton from "./PrintButton";

function fmtValue(m: Pick<MetricComparison, "key" | "unit" | "decimals">, v: number | null): string {
  if (v == null) return "—";
  if (m.key === "sleepHours") {
    const totalMin = Math.round(v * 60);
    return `${Math.floor(totalMin / 60)}h ${String(totalMin % 60).padStart(2, "0")}m`;
  }
  const n = v.toFixed(m.decimals);
  if (!m.unit) return n;
  return m.unit === "%" ? `${n}%` : `${n} ${m.unit}`;
}

function fmtDelta(m: MetricComparison): string {
  if (m.delta == null || m.direction == null) return "—";
  if (m.direction === "flat") return "no real change";
  const sign = m.delta > 0 ? "+" : "−";
  const abs = Math.abs(m.delta);
  const body =
    m.key === "sleepHours"
      ? `${Math.round(abs * 60)} min`
      : `${abs.toFixed(m.decimals)}${m.unit === "%" ? " pts" : m.unit ? ` ${m.unit}` : ""}`;
  return `${m.direction === "up" ? "▲" : "▼"} ${sign}${body}`;
}

function fmtMinutes(min: number): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

function rangeLabel(w: { start: string; end: string }): string {
  return `${formatDay(w.start)} – ${formatDay(w.end)}`;
}

export default function WeeklyReviewView({ review }: { review: WeeklyReview }) {
  const { comparable } = review;

  return (
    <div className="wr-root" data-testid="weekly-review">
      <header className="wr-header">
        <div>
          <h2 className="wr-title">Weekly review</h2>
          <div className="wr-range">
            {rangeLabel(review.current)}
            {comparable && <> · vs {rangeLabel(review.previous)}</>}
          </div>
        </div>
        <PrintButton />
      </header>

      {review.empty ? (
        <section className="card wr-card" data-testid="weekly-empty">
          <div className="card-title">Not enough data</div>
          <p className="wr-note">
            No scored recovery, sleep, strain or workouts in the last 7 days. Sync your Whoop
            data and check back.
          </p>
        </section>
      ) : (
        <>
          {!comparable && (
            <p className="wr-note wr-notice" data-testid="weekly-not-comparable">
              Not enough data to compare weeks — a comparison needs at least {MIN_SCORED_DAYS}{" "}
              scored days in each week (this week: {review.currentScoredDays}, last week:{" "}
              {review.previousScoredDays}). Showing this week only.
            </p>
          )}

          {review.highlights.length > 0 && (
            <section className="card wr-card" aria-labelledby="wr-highlights">
              <div className="card-title" id="wr-highlights">
                Highlights
              </div>
              <ul className="wr-highlights">
                {review.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="card wr-card" aria-labelledby="wr-averages">
            <div className="card-head">
              <div className="card-title" id="wr-averages">
                Daily averages
              </div>
              <div className="card-sub">changes under the noise threshold read as “no real change”</div>
            </div>
            <table className="wr-table">
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">This week</th>
                  {comparable && <th scope="col">Last week</th>}
                  {comparable && <th scope="col">Change</th>}
                </tr>
              </thead>
              <tbody>
                {review.metrics.map((m) => (
                  <tr key={m.key} data-metric={m.key}>
                    <th scope="row">{m.label}</th>
                    <td>
                      {fmtValue(m, m.current)}
                      {m.currentN > 0 && <span className="wr-n"> · {m.currentN}d</span>}
                    </td>
                    {comparable && <td>{fmtValue(m, m.previous)}</td>}
                    {comparable && (
                      <td className={`wr-delta ${m.tone ?? ""}`} data-direction={m.direction ?? "none"}>
                        {fmtDelta(m)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="wr-grid">
            <section className="card wr-card" aria-labelledby="wr-recovery-days">
              <div className="card-title" id="wr-recovery-days">
                Recovery days
              </div>
              {review.bestRecovery ? (
                <dl className="wr-dl">
                  <dt>Best</dt>
                  <dd>
                    {Math.round(review.bestRecovery.value)}% · {formatDay(review.bestRecovery.date)}
                  </dd>
                  <dt>Worst</dt>
                  <dd>
                    {review.worstRecovery
                      ? `${Math.round(review.worstRecovery.value)}% · ${formatDay(review.worstRecovery.date)}`
                      : "—"}
                  </dd>
                </dl>
              ) : (
                <p className="wr-note">No scored recovery this week.</p>
              )}
            </section>

            <section className="card wr-card" aria-labelledby="wr-sleep">
              <div className="card-title" id="wr-sleep">
                Sleep consistency
              </div>
              <dl className="wr-dl">
                <dt>Nights under 7 h</dt>
                <dd>
                  {review.sleepNights > 0 ? `${review.shortNights} of ${review.sleepNights}` : "—"}
                </dd>
                <dt>Bedtime spread</dt>
                <dd>{review.consistency ? `±${Math.round(review.consistency.bedtimeStdMin)} min` : "—"}</dd>
                <dt>Wake spread</dt>
                <dd>{review.consistency ? `±${Math.round(review.consistency.wakeStdMin)} min` : "—"}</dd>
              </dl>
              {!review.consistency && (
                <p className="wr-note">Bed/wake spread needs at least 5 nights with times.</p>
              )}
            </section>

            <section className="card wr-card" aria-labelledby="wr-training">
              <div className="card-title" id="wr-training">
                Training
              </div>
              <dl className="wr-dl">
                <dt>Workouts</dt>
                <dd>{review.workouts.count}</dd>
                <dt>Total time</dt>
                <dd>{review.workouts.count > 0 ? fmtMinutes(review.workouts.totalMin) : "—"}</dd>
                <dt>Zone 2</dt>
                <dd>{review.workouts.zone2Min != null ? fmtMinutes(review.workouts.zone2Min) : "—"}</dd>
              </dl>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
