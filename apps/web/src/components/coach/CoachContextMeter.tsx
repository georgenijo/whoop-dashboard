"use client";

import AnimatedNumber from "@/components/motion/AnimatedNumber";
import {
  contextLevel,
  formatTokenCount,
} from "@/lib/coach/context-window";

type Props = {
  /** Prompt size of the thread's latest model call. */
  tokens: number;
  /** Context-window size of the selected model. */
  window: number;
  /** Provider only reports a cumulative snapshot (Cursor): prefix "~". */
  approximate: boolean;
};

const LEVEL_LABEL = { ok: "", warn: "Context is filling up. ", danger: "Context is nearly full. " } as const;

/**
 * Issue #608 — compact "42k / 200k" context-window meter beside the Coach
 * model picker. Amber at 75%, red at 90%. The count springs between values
 * like the other live-instrument numbers (#641); the bar fills on the same
 * spring. Rendered only when the thread has a recorded figure.
 */
export default function CoachContextMeter({ tokens, window, approximate }: Props) {
  const level = contextLevel(tokens, window);
  const ratio = Math.min(1, Math.max(0, window > 0 ? tokens / window : 1));
  const percent = Math.round(ratio * 100);
  const used = `${approximate ? "~" : ""}${formatTokenCount(tokens)}`;
  const limit = formatTokenCount(window);
  const exact = `${approximate ? "About " : ""}${Math.round(tokens).toLocaleString("en-US")} of ${window.toLocaleString("en-US")} tokens`;
  return (
    <div
      className={`coach-context-meter is-${level}`}
      role="meter"
      aria-label="Context window"
      aria-valuemin={0}
      aria-valuemax={window}
      aria-valuenow={Math.min(Math.round(tokens), window)}
      aria-valuetext={`${LEVEL_LABEL[level]}${exact} (${percent}%)`}
      title={`${LEVEL_LABEL[level]}${exact} (${percent}%)${
        approximate ? ". Approximate: this provider reports one total per turn." : ""
      }`}
    >
      <span className="coach-context-meter-text" aria-hidden>
        <AnimatedNumber value={used} className="coach-context-meter-used" />
        <span className="coach-context-meter-limit"> / {limit}</span>
      </span>
      <span className="coach-context-meter-track" aria-hidden>
        <span
          className="coach-context-meter-fill"
          style={{ transform: `scaleX(${ratio})` }}
        />
      </span>
    </div>
  );
}
