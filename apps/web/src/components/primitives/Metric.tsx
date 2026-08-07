import Link from "next/link";
import type { MetricKey } from "./types";
import styles from "./primitives.module.css";

type Delta = {
  label: string;
  direction?: "up" | "down" | "flat";
};

type Props = {
  metric: MetricKey;
  label: string;
  value: number | string | null;
  unit?: string;
  tier?: "hero" | "quiet";
  delta?: Delta;
  href?: string;
  id: string;
};

export function Metric({
  metric,
  label,
  value,
  unit,
  tier = "quiet",
  delta,
  href,
  id,
}: Props) {
  const content = (
    <>
      <span className={styles.metricLabel} data-metric={metric}>
        <i aria-hidden />
        <span>{label}</span>
      </span>
      <span className={styles.metricValue}>
        {value ?? "—"}
        {unit && <span className={styles.metricUnit}>{unit}</span>}
      </span>
      {delta && (
        <span className={styles.metricDelta} data-direction={delta.direction ?? "flat"}>
          {delta.label}
        </span>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={styles.metric}
        data-tier={tier}
        data-od-id={id}
      >
        {content}
      </Link>
    );
  }

  return (
    <div className={styles.metric} data-tier={tier} data-od-id={id}>
      {content}
    </div>
  );
}
