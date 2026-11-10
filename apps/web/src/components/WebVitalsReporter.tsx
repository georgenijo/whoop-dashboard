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
}

// Send everything collected so far in as few beacons as the server cap allows
// (one, for a normal page load).
function flush(): void {
  if (pending.size === 0) return;
  const samples = [...pending.values()];
  pending.clear();
  for (let i = 0; i < samples.length; i += MAX_BATCH) send(samples.slice(i, i + MAX_BATCH));
}

function onVisibilityChange(): void {
  if (document.visibilityState === "hidden") flush();
}

export default function WebVitalsReporter() {
  useReportWebVitals(handleMetric);
  useEffect(() => {
    // The page is going away or being backgrounded (the last reliable moment
    // to send): flush the whole lifecycle's metrics in one beacon.
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  return null;
}
