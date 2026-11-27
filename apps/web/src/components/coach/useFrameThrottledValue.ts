"use client";

import { useEffect, useRef, useState } from "react";

/**
 * While `throttle` is on, returns `value` as of the last animation frame, so a
 * burst of streamed deltas costs one expensive render per frame instead of one
 * per delta. When `throttle` turns off (the stream finished) the latest value
 * is returned immediately.
 *
 * A pending frame is never cancelled by a newer value -- the callback reads
 * the latest one -- so a steady stream faster than 60 Hz still repaints every
 * frame instead of starving until it pauses.
 */
export function useFrameThrottledValue<T>(value: T, throttle: boolean): T {
  const [shown, setShown] = useState(value);
  const latestRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    latestRef.current = value;
    if (!throttle || frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setShown(latestRef.current);
    });
  }, [throttle, value]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return throttle ? shown : value;
}
