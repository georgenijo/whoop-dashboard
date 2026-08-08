import type { MetricKey } from "./types";
import styles from "./primitives.module.css";

export type ChartPoint = {
  label: string;
  value: number | null;
};

type Props = {
  metric: MetricKey;
  data: ChartPoint[];
  ariaLabel: string;
  startLabel: string;
  endLabel: string;
  valueLabel: string;
  id: string;
};

export function Chart({
  metric,
  data,
  ariaLabel,
  startLabel,
  endLabel,
  valueLabel,
  id,
}: Props) {
  const valid = data.filter(
    (point): point is { label: string; value: number } => point.value !== null,
  );
  const values = valid.map((point) => point.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = Math.max(1, max - min);
  const points = valid
    .map((point, index) => {
      const x = valid.length === 1 ? 300 : (index / (valid.length - 1)) * 300;
      const y = 94 - ((point.value - min) / span) * 78;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = points.split(" ").at(-1)?.split(",") ?? ["300", "52"];

  return (
    <figure className={styles.chart} data-metric={metric} data-od-id={id}>
      <svg viewBox="0 0 300 104" preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
        <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
        {valid.length > 0 && <circle cx={last[0]} cy={last[1]} r="2.75" />}
      </svg>
      <figcaption className={styles.chartFoot}>
        <span>{startLabel}</span>
        <span>{endLabel}</span>
        <strong>{valueLabel}</strong>
      </figcaption>
    </figure>
  );
}
