import Link from "next/link";
import {
  BAND_HIGH_PCT,
  BAND_LOW_PCT,
  BASELINE_WINDOWS,
  MIN_BASELINE_DAYS,
  TREND_LOOKBACK_DAYS,
  formatMetricValue,
  withUnit,
  type BandPosition,
  type BaselinesResult,
  type MetricBaseline,
} from "@/lib/analytics/baselines";
import { shiftDate } from "@/lib/range";
import styles from "./baselines.module.css";

const ACCENT = "#00d4aa";
const SPARK_W = 240;
const SPARK_H = 56;
const PAD = 4;

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === shiftDate(today, -1)) return "Yesterday";
  return shortDate(date);
}

const fmt = (m: MetricBaseline, v: number, signed = false) =>
  withUnit(formatMetricValue(v, m.decimals, signed), m.unit);

const POSITION_TEXT: Record<BandPosition, string> = {
  below: "Below your normal",
  within: "Within your normal",
  above: "Above your normal",
};

/**
 * Pill colour. Within is good; for directional metrics the good side is good.
 * Neutral metrics: a rise in respiratory rate or skin temperature is a
 * warning sign, a drop is not; strain is neither.
 */
function positionTone(m: MetricBaseline, p: BandPosition): "good" | "bad" | "neutral" {
  if (p === "within") return "good";
  if (m.direction === "neutral") return p === "above" && m.key !== "strain" ? "bad" : "neutral";
  return (m.direction === "higher") === (p === "above") ? "good" : "bad";
}

function dayIndex(date: string, start: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function Sparkline({ m, start, span }: { m: MetricBaseline; start: string; span: number }) {
  if (m.baseline == null || m.bandLow == null || m.bandHigh == null || m.series.length === 0) return null;
  const values = m.series.map((p) => p.value);
  let lo = Math.min(...values, m.bandLow);
  let hi = Math.max(...values, m.bandHigh);
  if (hi === lo) {
    lo -= 1;
    hi += 1;
  }
  const x = (date: string) => PAD + (dayIndex(date, start) / Math.max(1, span - 1)) * (SPARK_W - 2 * PAD);
  const y = (v: number) => PAD + ((hi - v) / (hi - lo)) * (SPARK_H - 2 * PAD);
  const d = m.series.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = m.series[m.series.length - 1];
  return (
    <svg
      className={styles.spark}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${m.label} over the window, normal range shaded from ${fmt(m, m.bandLow)} to ${fmt(m, m.bandHigh)}`}
      data-testid={`spark-${m.key}`}
    >
      <rect
        className={styles.band}
        x={0}
        width={SPARK_W}
        y={y(m.bandHigh)}
        height={Math.max(1, y(m.bandLow) - y(m.bandHigh))}
        data-band
      />
      <line className={styles.baseline} x1={0} x2={SPARK_W} y1={y(m.baseline)} y2={y(m.baseline)} />
      <path className={styles.line} d={d} vectorEffect="non-scaling-stroke" />
      <circle className={styles.dot} cx={x(last.date)} cy={y(last.value)} r={2.5} />
    </svg>
  );
}

function MetricCard({ m, result }: { m: MetricBaseline; result: BaselinesResult }) {
  const ready = m.status === "ready" && m.baseline != null && m.bandLow != null && m.bandHigh != null;
  const latest = m.latest;
  const tone = latest?.position ? positionTone(m, latest.position) : "neutral";
  return (
    <li className={`card ${styles.metric}`} data-testid={`baseline-${m.key}`} data-status={m.status} data-position={latest?.position ?? "none"}>
      <div className={styles.metricHead}>
        <div className={styles.name}>{m.label}</div>
        {ready && latest?.position && (
          <span className={`${styles.pill} ${styles[tone]}`}>{POSITION_TEXT[latest.position]}</span>
        )}
        {!ready && <span className={`${styles.pill} ${styles.neutral}`}>Building baseline</span>}
      </div>

      {ready ? (
        <>
          <div className={styles.values}>
            <div>
              <div className={styles.kLabel}>{latest ? dayLabel(latest.date, result.today) : "Latest"}</div>
              <div className={styles.kValue} data-testid={`latest-${m.key}`}>
                {latest == null ? "—" : m.showAsDeviation ? fmt(m, latest.delta ?? 0, true) : fmt(m, latest.value)}
              </div>
              {latest && m.showAsDeviation && (
                <div className={styles.kSub}>{fmt(m, latest.value)} measured</div>
              )}
            </div>
            <div>
              <div className={styles.kLabel}>Baseline</div>
              <div className={styles.kValue} data-testid={`median-${m.key}`}>{fmt(m, m.baseline!)}</div>
              <div className={styles.kSub}>median of {m.days} days</div>
            </div>
            <div>
              <div className={styles.kLabel}>Normal range</div>
              <div className={styles.kValue} data-testid={`band-${m.key}`}>
                {formatMetricValue(m.bandLow!, m.decimals)}–{fmt(m, m.bandHigh!)}
              </div>
              <div className={styles.kSub}>middle half of your days</div>
            </div>
          </div>
          <Sparkline m={m} start={m.start} span={result.windowDays} />
          <div className={styles.trend} data-testid={`trend-${m.key}`} data-trend={m.trend?.direction ?? "none"}>
            {m.trend == null ? (
              <>Baseline trend: not enough history for {TREND_LOOKBACK_DAYS} days ago</>
            ) : (
              <>
                Baseline trend:{" "}
                <span className={styles[m.trend.meaning === "better" ? "good" : m.trend.meaning === "worse" ? "bad" : "muted"]}>
                  {m.trend.direction === "steady" ? "→ steady" : m.trend.direction === "rising" ? "↑ rising" : "↓ falling"}
                </span>{" "}
                ({fmt(m, m.trend.change, true)} vs {fmt(m, m.trend.previous)} {TREND_LOOKBACK_DAYS} days ago)
              </>
            )}
          </div>
        </>
      ) : (
        <div className={styles.building}>
          <div className={styles.meter} aria-hidden>
            <span style={{ width: `${Math.min(100, (m.days / MIN_BASELINE_DAYS) * 100)}%` }} />
          </div>
        </div>
      )}

      <p className={styles.summary} data-testid={`summary-${m.key}`}>{m.summary}</p>
      <p className={styles.about}>{m.about}</p>
    </li>
  );
}

export default function BaselinesView({ result }: { result: BaselinesResult }) {
  const { windowDays, start, today } = result;
  return (
    <>
      <div className="card" data-testid="baselines-hero">
        <div className={styles.head}>
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: ACCENT, color: ACCENT }} />
              Your baselines
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              What is normal for you over the last {windowDays} days ({shortDate(start)}–{shortDate(today)})
            </div>
          </div>
          <nav className={styles.toggle} aria-label="Baseline window">
            {BASELINE_WINDOWS.map((w) => (
              <Link key={w} href={`/baselines?window=${w}`} aria-current={w === windowDays ? "page" : undefined}>
                {w} days
              </Link>
            ))}
          </nav>
        </div>
        <p className={styles.method}>
          Baseline = median of your daily values in the window. Normal range = the{" "}
          {Math.round(BAND_LOW_PCT * 100)}th–{Math.round(BAND_HIGH_PCT * 100)}th percentile (the middle half of
          your days), shaded on each chart. A metric needs {MIN_BASELINE_DAYS} days of data before it gets a
          baseline. The trend compares today&apos;s baseline with the one from {TREND_LOOKBACK_DAYS} days ago. Day
          strain uses yesterday, because today is still in progress.
        </p>
        {!result.anyReady && (
          <div className="empty-state" data-testid="baselines-empty">
            <div className="title">Building your baselines</div>
            <div className="sub">
              Each metric needs {MIN_BASELINE_DAYS} days of Whoop data in the window. Keep wearing your strap — they
              fill in automatically.
            </div>
          </div>
        )}
      </div>
      <ul className={styles.grid}>
        {result.metrics.map((m) => (
          <MetricCard key={m.key} m={m} result={result} />
        ))}
      </ul>
    </>
  );
}
