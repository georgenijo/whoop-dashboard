"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Poll the lightweight status route with backoff instead of re-rendering the
// whole Overview every 5s. The first poll runs soon after mount (the page
// has already scheduled regeneration in `after()`); later polls stretch out
// so a slow provider costs a handful of cheap requests, and a known terminal
// failure stops the loop immediately.
const POLL_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000, 60_000];

type InsightStatusPayload = {
  ready?: boolean;
  failed?: boolean;
};

export default function AIInsightRefreshWatcher() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const finish = () => {
      if (cancelled) return;
      // One full refresh reveals either the new insight or the persisted
      // unavailable state in the server-rendered card. No polling remains.
      router.refresh();
    };

    const scheduleNext = () => {
      if (cancelled) return;
      const delay =
        POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)];
      attempt += 1;
      timer = setTimeout(poll, delay);
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        const response = await fetch("/api/insights/status", {
          cache: "no-store",
        });
        if (!response.ok) {
          scheduleNext();
          return;
        }
        const data = (await response.json()) as InsightStatusPayload;
        if (data.ready || data.failed) {
          finish();
          return;
        }
        scheduleNext();
      } catch {
        scheduleNext();
      }
    };

    scheduleNext();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [router]);

  return null;
}
