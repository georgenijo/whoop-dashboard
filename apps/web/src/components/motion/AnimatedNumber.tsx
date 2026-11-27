"use client";

import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  SPRINGS,
  type SpringConfig,
  formatParsedDisplay,
  parseDisplayNumber,
  springProgress,
  springSettleTime,
} from "@/lib/motion";

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(notify: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCE_QUERY);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

function reducedMotionSnapshot(): boolean {
  // No matchMedia (jsdom, very old engines) means no way to honour the
  // preference, so treat it as "reduce": the static value is always correct.
  if (typeof window.matchMedia !== "function") return true;
  return window.matchMedia(REDUCE_QUERY).matches;
}

/** True when motion should be skipped: user preference, server, or no API. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, reducedMotionSnapshot, () => true);
}

type Props = {
  /** The exact string to show at rest, e.g. "78%" or "45.8 ms". */
  value: string;
  className?: string;
  /** Milliseconds to wait after the number scrolls into view. */
  delay?: number;
  spring?: SpringConfig;
};

/**
 * Counts a display value up to its target the first time it scrolls into
 * view, then springs between values when it changes.
 *
 * The rendered text is the final value on the server, in tests, under reduced
 * motion, and for compound values ("7h 12m") that have no single number to
 * animate — so nothing that reads the DOM ever depends on the animation. The
 * layout effect swaps in the start value before first paint, so the count-up
 * never flashes the final value first.
 */
export default function AnimatedNumber({ value, className, delay = 0, spring = SPRINGS.smooth }: Props) {
  const reduced = usePrefersReducedMotion();
  const parsed = useMemo(() => parseDisplayNumber(value), [value]);
  const [text, setText] = useState(value);
  const [animating, setAnimating] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const shownRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    const canAnimate =
      !reduced &&
      parsed !== null &&
      element !== null &&
      typeof IntersectionObserver === "function" &&
      typeof requestAnimationFrame === "function";
    if (!canAnimate) {
      shownRef.current = parsed?.value ?? null;
      // Sync the rendered text to a prop that changed while motion was off.
      setText(value);
      setAnimating(false);
      return;
    }

    const from = shownRef.current ?? 0;
    const to = parsed.value;
    if (from === to) {
      setText(value);
      return;
    }
    // Paint the starting value before the browser shows the final one.
    setText(formatParsedDisplay(parsed, from));

    const settle = springSettleTime(spring) * 1000;
    let frame = 0;
    let timer = 0;
    let startedAt = 0;

    const tick = (now: number) => {
      if (!startedAt) startedAt = now;
      const elapsed = now - startedAt;
      if (elapsed >= settle) {
        shownRef.current = to;
        setText(value);
        setAnimating(false);
        return;
      }
      const current = from + (to - from) * springProgress(elapsed / 1000, spring);
      shownRef.current = current;
      setText(formatParsedDisplay(parsed, current));
      frame = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setAnimating(true);
        timer = window.setTimeout(() => {
          frame = requestAnimationFrame(tick);
        }, delay);
      },
      { threshold: 0.35 },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [delay, parsed, reduced, spring, value]);

  const classes = className ? `motion-number ${className}` : "motion-number";
  // While motion is possible the visible glyphs can be mid-flight (or parked
  // at the start value off-screen), so assistive tech reads the settled value
  // from a separate node instead.
  if (!reduced && parsed !== null) {
    return (
      <span ref={ref} className={classes} data-animating={animating || undefined}>
        <span aria-hidden="true">{text}</span>
        <span className="sr-only">{value}</span>
      </span>
    );
  }
  return (
    <span ref={ref} className={classes}>
      {text}
    </span>
  );
}
