"use client";

import { useState, type ReactNode } from "react";
import styles from "./brainless.module.css";

/**
 * Adapted from the Brainless `codex-exec` registry item.
 *
 * The expanded body is a div because Coach tool results may contain semantic
 * tables, buttons, and nested disclosures rather than plain terminal text.
 */
export type AgentToolState = "active" | "success" | "failure";

type AgentToolDisclosureProps = Readonly<{
  state: AgentToolState;
  label: string;
  result?: string;
  defaultOpen?: boolean;
  className?: string;
  children?: ReactNode;
}>;

function stateMark(state: AgentToolState): string {
  if (state === "success") return "✓";
  if (state === "failure") return "×";
  return "";
}

export function AgentToolDisclosure({
  state,
  label,
  result,
  defaultOpen = false,
  className,
  children,
}: AgentToolDisclosureProps) {
  const expandable = children !== undefined && children !== null;
  const [open, setOpen] = useState(defaultOpen);
  const classes = className
    ? `${styles.toolDisclosure} ${className}`
    : styles.toolDisclosure;

  if (!expandable) {
    return (
      <div
        className={classes}
        data-brainless="tool-disclosure"
        data-state={state}
      >
        <div
          className={styles.toolSummary}
          aria-label={result ? `${label}, ${result}` : label}
        >
          <span className={styles.toolMark} aria-hidden="true">
            {stateMark(state)}
          </span>
          <span className={styles.toolLabel}>{label}</span>
          {result ? <span className={styles.toolResult}>{result}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <details
      className={classes}
      data-brainless="tool-disclosure"
      data-state={state}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        className={styles.toolSummary}
        aria-label={result ? `${label}, ${result}` : label}
      >
        <span className={styles.toolMark} aria-hidden="true">
          {stateMark(state)}
        </span>
        <span className={styles.toolLabel}>{label}</span>
        {result ? <span className={styles.toolResult}>{result}</span> : null}
        <span className={styles.toolCaret} aria-hidden="true" />
      </summary>
      <div className={styles.toolBody}>{children}</div>
    </details>
  );
}
