"use client";

import { useReportWebVitals } from "next/web-vitals";

// Frontend performance telemetry collector. Reports Core Web Vitals to
// /api/perf (read back on the /perf page). Fire-and-forget via sendBeacon so it
// never blocks navigation or the unload path; falls back to keepalive fetch.
// Mounted once from the (dashboard) layout.

type WebVitalMetric = {
  name: string;
  value: number;
  rating?: string;
  navigationType?: string;
};

// Only the standard Web Vitals — drop Next.js's internal hydration/render
// metrics so the table stays a known shape (matches PERF_METRICS server-side).
const TRACKED = new Set(["LCP", "INP", "CLS", "FCP", "TTFB", "FID"]);

function report(metric: WebVitalMetric): void {
  if (typeof window === "undefined") return;
  if (!TRACKED.has(metric.name)) return;

  const body = JSON.stringify({
    source: "web",
    metric: metric.name,
    value: metric.value,
    rating: metric.rating,
    path: window.location.pathname,
    navigation_type: metric.navigationType,
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

export default function WebVitalsReporter() {
  useReportWebVitals(report);
  return null;
}
