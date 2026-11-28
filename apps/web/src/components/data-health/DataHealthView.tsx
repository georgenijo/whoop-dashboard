import Link from "next/link";
import {
  DATA_HEALTH_WINDOWS,
  daysBetween,
  type DataHealthSummary,
  type MetricCoverage,
} from "@/lib/analytics/dataHealth";
import styles from "./data-health.module.css";

const ACCENT = "#00d4aa";

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function gapRange(start: string, end: string): string {
  return start === end ? shortDate(start) : `${shortDate(start)}–${shortDate(end)}`;
}

/** An ISO instant in the user's zone, e.g. "Nov 27, 8:14 AM". */
export function formatInstant(iso: string, tz: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}

const STATUS_TEXT: Record<MetricCoverage["status"], string> = {
  complete: "Complete",
  good: "Good",
  patchy: "Patchy",
  poor: "Sparse",
  none: "No data",
  "not-recorded": "Not recorded",
  activity: "Activity",
};

function cellTitle(m: MetricCoverage, date: string, state: string): string {
  const what =
    state === "present"
      ? m.kind === "activity" ? "workout logged" : "recorded"
      : state === "missing"
        ? "missing"
        : state === "pending"
          ? "not in yet (today)"
          : m.kind === "activity" ? "no workout" : "not recorded";
  return `${m.label} · ${shortDate(date)}: ${what}`;
}

function MetricRow({ m }: { m: MetricCoverage }) {
  const sub =
    m.status === "not-recorded"
      ? "Your device didn't report this metric in this window"
      : m.kind === "activity"
        ? `${m.present} active day${m.present === 1 ? "" : "s"}`
        : m.longestGap
          ? `Longest gap ${m.longestGap.days}d · ${gapRange(m.longestGap.start, m.longestGap.end)}`
          : m.present > 0 ? "No gaps" : "Nothing recorded yet";
  return (
    <li className={styles.row} data-testid={`metric-${m.key}`} data-status={m.status}>
      <div>
        <div className={styles.name}>{m.label}</div>
        <div className={styles.nameSub}>{sub}</div>
      </div>
      <div
        className={styles.strip}
        role="img"
        aria-label={
          m.kind === "activity"
            ? `${m.label}: ${m.present} of ${m.days.length} days had a workout`
            : m.status === "not-recorded"
              ? `${m.label}: not recorded`
              : `${m.label}: ${m.present} of ${m.expected} days recorded`
        }
      >
        {m.days.map((d) => (
          <span
            key={d.date}
            data-state={d.state}
            title={cellTitle(m, d.date, d.state)}
            className={`${styles.cell} ${
              d.state === "present"
                ? m.kind === "activity" ? styles.activity : styles.present
                : styles[d.state]
            }`}
          />
        ))}
      </div>
      <div className={styles.stat}>
        {m.kind === "activity" || m.status === "not-recorded" ? (
          <span className={styles.muted}>{m.kind === "activity" ? `${m.present}/${m.days.length}` : "—"}</span>
        ) : (
          <span className={styles[m.status]}>{m.pct === null ? "—" : `${m.pct}%`}</span>
        )}
        <div className={styles.statSub}>
          {m.kind === "activity" || m.status === "not-recorded"
            ? STATUS_TEXT[m.status]
            : `${m.present}/${m.expected} days · ${STATUS_TEXT[m.status]}`}
        </div>
      </div>
    </li>
  );
}

function Card({ title, sub, color = ACCENT, children, testId }: {
  title: string;
  sub?: string;
  color?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="card" style={{ marginTop: 24 }} data-testid={testId}>
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: color, color }} />
            {title}
          </div>
          {sub && <div className="card-sub" style={{ marginTop: 4 }}>{sub}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

export default function DataHealthView({ summary, tz }: { summary: DataHealthSummary; tz: string }) {
  const { metrics, window, today } = summary;
  const groups = ["Recovery", "Sleep", "Strain"] as const;
  const daily = metrics.filter((m) => m.kind === "daily" && m.status !== "not-recorded");
  const totalMissing = daily.reduce((s, m) => s + m.missing, 0);
  const hasAnyData = metrics.some((m) => m.present > 0);
  const staleDays = summary.latestDataDate ? daysBetween(summary.latestDataDate, today) : null;
  const gappy = daily.filter((m) => m.missing > 0);
  const midIdx = Math.floor(summary.dates.length / 2);

  return (
    <>
      <div className="card" data-testid="data-health-hero">
        <div className={styles.head}>
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: ACCENT, color: ACCENT }} />
              Data health
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              How complete your Whoop data is over the last {window} days ({shortDate(summary.start)}–{shortDate(today)})
            </div>
          </div>
          <nav className={styles.toggle} aria-label="Coverage window">
            {DATA_HEALTH_WINDOWS.map((w) => (
              <Link key={w} href={`/data-health?window=${w}`} aria-current={w === window ? "page" : undefined}>
                {w} days
              </Link>
            ))}
          </nav>
        </div>

        <div className={styles.kpis}>
          <div>
            <div className={styles.kpiLabel}>Core coverage</div>
            <div className={styles.kpiValue} data-testid="overall-pct">
              {summary.overallPct === null ? "—" : `${summary.overallPct}%`}
            </div>
            <div className={styles.kpiSub}>Recovery, sleep and strain days recorded</div>
          </div>
          <div>
            <div className={styles.kpiLabel}>Missing metric-days</div>
            <div className={styles.kpiValue}>{totalMissing}</div>
            <div className={styles.kpiSub}>Across {daily.length} daily metrics</div>
          </div>
          <div>
            <div className={styles.kpiLabel}>Newest data</div>
            <div className={styles.kpiValue} data-testid="newest-data">
              {summary.latestDataDate ? shortDate(summary.latestDataDate) : "—"}
            </div>
            <div className={styles.kpiSub}>
              {staleDays === null
                ? "No Whoop data yet"
                : staleDays === 0
                  ? "Up to date (today)"
                  : `${staleDays} day${staleDays === 1 ? "" : "s"} ago`}
            </div>
          </div>
          <div>
            <div className={styles.kpiLabel}>Data warnings</div>
            <div className={styles.kpiValue}>{summary.warningTotal}</div>
            <div className={styles.kpiSub}>Duplicate or overlapping sleeps</div>
          </div>
        </div>
      </div>

      <Card
        title={`Coverage · ${window} days`}
        sub="One cell per day, oldest on the left. Today stays dashed until its data arrives."
        testId="coverage-card"
      >
        {!hasAnyData ? (
          <div className="empty-state">
            <div className="title">No Whoop data in this window</div>
            <div className="sub">Connect Whoop or run a sync from Settings; coverage fills in as days arrive.</div>
          </div>
        ) : (
          <>
            {groups.map((g) => (
              <section key={g} aria-label={`${g} metrics`}>
                <div className={styles.groupLabel}>{g}</div>
                <ul className={styles.rows} style={{ margin: 0 }}>
                  {metrics.filter((m) => m.group === g).map((m) => (
                    <MetricRow key={m.key} m={m} />
                  ))}
                </ul>
              </section>
            ))}
            <div className={styles.axis} aria-hidden>
              <span>{shortDate(summary.dates[0])}</span>
              <span>{shortDate(summary.dates[midIdx])}</span>
              <span>Today</span>
            </div>
            <div className={styles.legend}>
              <span><i className={styles.swatch} style={{ background: "#00d4aa" }} />Recorded</span>
              <span><i className={styles.swatch} style={{ background: "#ff4d6a" }} />Missing</span>
              <span><i className={styles.swatch} style={{ background: "#5aa9ff" }} />Workout day</span>
              <span><i className={styles.swatch} style={{ background: "rgba(255,255,255,0.06)" }} />Rest day / not recorded</span>
            </div>
          </>
        )}
      </Card>

      <Card
        title="What missing data affects"
        sub="Features that need a minimum amount of history, and what gaps do to the rest"
        color="#ffaa00"
        testId="affects-card"
      >
        {summary.requirements.length > 0 && (
          <ul className={styles.list} data-testid="requirements">
            {summary.requirements.map((r) => (
              <li key={r.key} data-met={r.met ? "yes" : "no"}>
                <div className={styles.itemHead}>
                  <span>{r.feature}</span>
                  <span className={`${styles.meta} ${r.met ? styles.ok : styles.warn}`}>
                    {r.have}/{r.need} days · last {r.lookbackDays}d · {r.met ? "Ready" : "Needs more data"}
                  </span>
                </div>
                <p className={styles.detail}>{r.explanation}</p>
              </li>
            ))}
          </ul>
        )}
        {gappy.length > 0 ? (
          <ul className={styles.list} data-testid="gap-effects">
            {gappy.map((m) => (
              <li key={m.key}>
                <div className={styles.itemHead}>
                  <span>{m.label}</span>
                  <span className={styles.meta}>{m.missing} missing day{m.missing === 1 ? "" : "s"}</span>
                </div>
                <p className={styles.detail}>{m.affects}</p>
              </li>
            ))}
          </ul>
        ) : (
          hasAnyData && <p className={styles.empty}>No missing days in this window — every trend has full data.</p>
        )}
        {!hasAnyData && summary.requirements.length === 0 && (
          <p className={styles.empty}>Once data arrives, this lists what each gap affects.</p>
        )}
      </Card>

      <Card
        title="Duplicates & overlaps"
        sub="Same rules the charts use: one main sleep per day (the longest), naps kept separate"
        color="#ff4d6a"
        testId="warnings-card"
      >
        {summary.warnings.length === 0 ? (
          <p className={styles.empty}>No duplicate or overlapping sleeps in this window.</p>
        ) : (
          <>
            <ul className={styles.list}>
              {summary.warnings.map((w, i) => (
                <li key={`${w.kind}-${w.date}-${i}`} data-kind={w.kind}>
                  <div className={styles.itemHead}>
                    <span>{w.title}</span>
                    <span className={styles.meta}>{shortDate(w.date)}</span>
                  </div>
                  <p className={styles.detail}>{w.detail}</p>
                </li>
              ))}
            </ul>
            {summary.warningTotal > summary.warnings.length && (
              <p className={styles.note}>
                Showing the newest {summary.warnings.length} of {summary.warningTotal}.
              </p>
            )}
          </>
        )}
      </Card>

      <Card title="Last sync by source" sub="From your recent sync history" color="#5aa9ff" testId="sync-card">
        {summary.sync.length === 0 ? (
          <p className={styles.empty}>
            No sync history recorded.
            {summary.latestDataDate ? ` Your newest data is from ${shortDate(summary.latestDataDate)}.` : ""}
          </p>
        ) : (
          <ul className={styles.list}>
            {summary.sync.map((s) => (
              <li key={s.source} data-source={s.source}>
                <div className={styles.itemHead}>
                  <span>{s.label}</span>
                  <span className={`${styles.meta} ${s.failing ? styles.bad : styles.ok}`}>
                    {s.failing ? "Last attempt failed" : s.lastOkAt ? "OK" : "Never succeeded"}
                  </span>
                </div>
                <p className={styles.detail}>
                  {s.lastOkAt ? `Last success ${formatInstant(s.lastOkAt, tz)}` : "No successful sync yet"}
                  {s.failing && s.lastErrorAt ? ` · failed ${formatInstant(s.lastErrorAt, tz)}: ${s.failing}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="card-sub" style={{ marginTop: 16 }}>
        A day counts as recorded when Whoop scored it. Days are your local calendar days ({tz}). Nothing here
        changes your data — it only reads what is already synced.
      </p>
    </>
  );
}
