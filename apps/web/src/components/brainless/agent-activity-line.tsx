import styles from "./brainless.module.css";

/**
 * Adapted from the Brainless `codex-working` registry item.
 *
 * Coach supplies real phase and elapsed data. This component deliberately
 * omits provider names, token estimates, and interrupt hints that the product
 * cannot prove.
 */
export type AgentActivityState = "active" | "complete" | "failed" | "stopped";

type AgentActivityLineProps = Readonly<{
  state: AgentActivityState;
  label: string;
  detail?: string | null;
  meta?: string | null;
}>;

function settledMark(state: Exclude<AgentActivityState, "active">): string {
  if (state === "complete") return "✓";
  if (state === "failed") return "×";
  return "■";
}

export function AgentActivityLine({
  state,
  label,
  detail,
  meta,
}: AgentActivityLineProps) {
  const active = state === "active";

  return (
    <span
      className={styles.activity}
      data-brainless="activity"
      data-state={state}
      role={active ? "status" : undefined}
      aria-live={active ? "polite" : undefined}
    >
      <span className={styles.activityMark} aria-hidden="true">
        {active ? null : settledMark(state)}
      </span>
      <span className={styles.activityLabel}>{label}</span>
      {detail ? <span className={styles.activityDetail}>{detail}</span> : null}
      {meta ? (
        <span className={styles.activityMeta} aria-hidden="true">
          {meta}
        </span>
      ) : null}
    </span>
  );
}
