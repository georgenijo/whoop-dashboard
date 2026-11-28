// Server-rendered markup for /compare. No "use client": the picker is a plain
// GET <form> and preset links, so the page needs no client JS of its own.
import {
  formatChange,
  formatRange,
  formatValue,
  sparklinePaths,
  type MetricComparison,
  type PresetKey,
  type ResolvedComparison,
} from "@/lib/analytics/comparePeriods";
import styles from "./compare.module.css";

const ARROWS = { up: "↑", down: "↓", flat: "→" } as const;

const VERDICT_TEXT: Record<MetricComparison["verdict"], string> = {
  better: "better",
  worse: "worse",
  same: "about the same",
  changed: "changed",
  "no-data": "not enough data",
};

const SPARK_W = 120;
const SPARK_H = 32;

function Sparkline({ row }: { row: MetricComparison }) {
  const paths = sparklinePaths(row.a.series, row.b.series, SPARK_W, SPARK_H);
  return (
    <svg
      className={styles.spark}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      width={SPARK_W}
      height={SPARK_H}
      role="img"
      aria-label={`${row.def.label} daily values, period A over period B`}
    >
      {paths.b && <path d={paths.b} className={styles.sparkB} data-series="b" />}
      {paths.a && <path d={paths.a} className={styles.sparkA} data-series="a" />}
    </svg>
  );
}

function MetricRow({ row }: { row: MetricComparison }) {
  const { def } = row;
  const unit = def.unit ? <span className={styles.unit}>{def.unit}</span> : null;
  const pct =
    row.changePct != null && row.verdict !== "same" && Number.isFinite(row.changePct)
      ? ` (${row.changePct > 0 ? "+" : "−"}${Math.abs(row.changePct).toFixed(0)}%)`
      : "";
  return (
    <li className={styles.row} data-metric={def.key} data-verdict={row.verdict}>
      <div className={styles.metric}>
        <div className={styles.label}>{def.label}</div>
        <div className={styles.days}>
          {row.a.scoredDays} / {row.b.scoredDays} days scored
        </div>
      </div>
      <div className={styles.val} data-side="a">
        {formatValue(def, row.a.value)}
        {row.a.value != null && unit}
      </div>
      <div className={styles.val} data-side="b">
        {formatValue(def, row.b.value)}
        {row.b.value != null && unit}
      </div>
      <div className={`${styles.change} ${styles[row.verdict] ?? ""}`}>
        {row.direction && (
          <span className={styles.arrow} aria-hidden>
            {ARROWS[row.direction]}
          </span>
        )}
        <span>
          {row.verdict === "no-data" ? "—" : `${formatChange(def, row.change)}${pct}`}
        </span>
        <span className={styles.verdict}>{VERDICT_TEXT[row.verdict]}</span>
      </div>
      <Sparkline row={row} />
    </li>
  );
}

export default function CompareView({
  resolved,
  rows,
  today,
  presets,
}: {
  resolved: ResolvedComparison;
  rows: MetricComparison[];
  today: string;
  presets: { key: PresetKey; label: string }[];
}) {
  const { a, b } = resolved;
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Compare periods</h1>
        <p className={styles.lede}>
          Averages per scored day; workouts as per-week rates. Small changes inside each
          metric&apos;s noise band read as &ldquo;about the same&rdquo;.
        </p>
      </header>

      <nav className={styles.presets} aria-label="Comparison presets">
        {presets.map((p) => (
          <a
            key={p.key}
            href={`/compare?preset=${p.key}`}
            className={`${styles.preset} ${resolved.preset === p.key ? styles.presetActive : ""}`}
            aria-current={resolved.preset === p.key ? "page" : undefined}
          >
            {p.label}
          </a>
        ))}
      </nav>

      <form method="get" action="/compare" className={`card ${styles.form}`}>
        <fieldset className={styles.fs}>
          <legend>Period A</legend>
          <label>
            From <input type="date" name="a_from" defaultValue={a.from} max={today} required />
          </label>
          <label>
            To <input type="date" name="a_to" defaultValue={a.to} max={today} required />
          </label>
        </fieldset>
        <fieldset className={styles.fs}>
          <legend>Period B</legend>
          <label>
            From <input type="date" name="b_from" defaultValue={b.from} max={today} required />
          </label>
          <label>
            To <input type="date" name="b_to" defaultValue={b.to} max={today} required />
          </label>
        </fieldset>
        <button type="submit" className={styles.submit}>
          Compare
        </button>
      </form>

      {resolved.errors.length > 0 && (
        <div className={styles.errors} role="alert">
          <strong>Showing the default comparison instead:</strong>
          <ul>
            {resolved.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {resolved.notes.length > 0 && (
        <ul className={styles.notes} aria-label="Notes">
          {resolved.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <section className={`card ${styles.table}`} aria-label="Comparison">
        <div className={`${styles.row} ${styles.headerRow}`} aria-hidden>
          <div>Metric</div>
          <div data-side="a">
            <span className={styles.swatchA} /> A · {formatRange(a)}
            <span className={styles.len}>{a.days} days</span>
          </div>
          <div data-side="b">
            <span className={styles.swatchB} /> B · {formatRange(b)}
            <span className={styles.len}>{b.days} days</span>
          </div>
          <div>Change (A − B)</div>
          <div>Daily</div>
        </div>
        <ul className={styles.rows}>
          {rows.map((r) => (
            <MetricRow key={r.def.key} row={r} />
          ))}
        </ul>
      </section>
    </div>
  );
}
