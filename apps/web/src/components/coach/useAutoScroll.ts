"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** How close to the bottom (px) still counts as "reading the latest". */
export const NEAR_BOTTOM_PX = 80;

export function isNearBottom(element: HTMLElement): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    NEAR_BOTTOM_PX
  );
}

/**
 * Follows new content only while the reader is already at the bottom of the
 * transcript. Once they scroll up, streamed deltas leave their position alone
 * and `showJump` offers a way back instead.
 *
 * Scrolling is instant (not smooth): a smooth scroll per streamed delta both
 * janks and emits intermediate scroll events that would read as the user
 * leaving the bottom.
 */
export function useAutoScroll<T>(content: T, resetKey: unknown) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToEnd = useCallback(() => {
    const element = containerRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, []);

  const onScroll = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    const pinned = isNearBottom(element);
    pinnedRef.current = pinned;
    setShowJump(!pinned);
  }, []);

  /** Re-pin to the bottom, e.g. when the user sends or taps "Jump to latest". */
  const jumpToLatest = useCallback(() => {
    pinnedRef.current = true;
    setShowJump(false);
    scrollToEnd();
  }, [scrollToEnd]);

  // A different thread always opens at its newest message. The flag resets
  // during render (React's "adjust state on prop change" pattern); the pin
  // itself is a ref, so it resets in the layout effect below.
  const [shownKey, setShownKey] = useState(resetKey);
  if (shownKey !== resetKey) {
    setShownKey(resetKey);
    setShowJump(false);
  }
  const pinnedKeyRef = useRef(resetKey);

  useLayoutEffect(() => {
    if (pinnedKeyRef.current !== resetKey) {
      pinnedKeyRef.current = resetKey;
      pinnedRef.current = true;
    }
    if (pinnedRef.current) scrollToEnd();
    else setShowJump(true);
  }, [content, resetKey, scrollToEnd]);

  return { containerRef, onScroll, showJump, jumpToLatest };
}
