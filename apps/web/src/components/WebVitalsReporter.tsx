"use client";

import { useEffect } from "react";
import { useReportWebVitals } from "next/web-vitals";

// Frontend performance telemetry collector. Reports Core Web Vitals to
// /api/perf (read back on the /perf page). Fire-and-forget via sendBeacon so it
// never blocks navigation or the unload path; falls back to keepalive fetch.
// Mounted once from the (dashboard) layout.

type WebVitalMetric = {
  id?: string;
  name: string;
  value: number;
  rating?: string;
  navigationType?: string;
};

// Only the standard Web Vitals — drop Next.js's internal hydration/render
// metrics so the table stays a known shape (matches PERF_METRICS server-side).
const TRACKED = new Set(["LCP", "INP", "CLS", "FCP", "TTFB", "FID"]);

// The server accepts at most this many samples per request.
const MAX_BATCH = 10;

type Sample = { metric: WebVitalMetric; path: string };

// Samples collected over the page lifecycle, keyed by metric id (falling back
// to name). Next re-reports LCP/INP/CLS as they change, so the latest value per
// id wins instead of every revision being sent. Module state on purpose: the
// handler handed to useReportWebVitals must keep one identity for the life of
// the page, otherwise Next replays already-reported metrics to the "new"
// callback (see the useReportWebVitals docs).
const pending = new Map<string, Sample>();

function send(samples: Sample[]): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({
    metrics: samples.map(({ metric, path }) => ({
      source: "web",
      metric: metric.name,
      value: metric.value,
      rating: metric.rating,
      path,
      navigation_type: metric.navigationType,
    })),
  });

  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/perf", new Blob([body], { type: "application/json" }));
      return;
    }
  } catch {
    // Fall through to fetch.
  }
  void fetch("/api/perf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => {});
}

function handleMetric(metric: WebVitalMetric): void {
  if (!TRACKED.has(metric.name)) return;
  pending.set(metric.id ?? metric.name, {
    metric,
    // The page a sample describes, not wherever the user has navigated to by
    // the time the batch is flushed.
    path: typeof window === "undefined" ? "" : window.location.pathname,
  });
  // A metric that finalizes after the page is already hidden (a late observer
  // callback) has no later lifecycle event to ride on: send it on the next task.
  // Coalesced, so metrics finalized together still share one beacon.
  if (typeof document !== "undefined" && document.visibilityState === "hidden") scheduleFlush();
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, 0);
}

// Send everything collected so far in as few beacons as the server cap allows
// (one, for a normal page load).
function flush(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pending.size === 0) return;
  const samples = [...pending.values()];
  pending.clear();
  for (let i = 0; i < samples.length; i += MAX_BATCH) send(samples.slice(i, i + MAX_BATCH));
}

// Next's `useReportWebVitals` finalizes CLS (and the other "report on hide"
// metrics) inside its own `visibilitychange` listeners, and for CLS that
// listener is installed only after the asynchronous first-contentful-paint
// observation, i.e. AFTER any listener this component registers on `document`.
// Flushing from a `document` listener would therefore send the batch without
// CLS, then a second beacon for it. Two things make the flush land after every
// finalization callback:
//   1. `visibilitychange` bubbles from `document` to `window`, and a bubble-phase
//      `window` listener runs after all `document`-level listeners whatever order
//      they were registered in, synchronously (no timer that a freezing tab
//      might never run);
//   2. a `document` listener that defers to the next task, as a net for events
//      that do not bubble and for finalization that lands asynchronously.
function onDocumentVisibilityChange(): void {
  if (document.visibilityState === "hidden") scheduleFlush();
}

function onWindowVisibilityChange(): void {
  if (document.visibilityState === "hidden") flush();
}

export default function WebVitalsReporter() {
  useReportWebVitals(handleMetric);
  useEffect(() => {
    document.addEventListener("visibilitychange", onDocumentVisibilityChange);
    window.addEventListener("visibilitychange", onWindowVisibilityChange);
    // Some browsers fire only pagehide when a visible page is closed: send what
    // we have rather than risk losing it.
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onDocumentVisibilityChange);
      window.removeEventListener("visibilitychange", onWindowVisibilityChange);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  return null;
}
