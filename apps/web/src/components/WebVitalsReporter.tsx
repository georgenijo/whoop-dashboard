"use client";

import { useEffect, useRef } from "react";
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

function send(metrics: WebVitalMetric[]): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({
    metrics: metrics.map((metric) => ({
      source: "web",
      metric: metric.name,
      value: metric.value,
      rating: metric.rating,
      path: window.location.pathname,
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

export default function WebVitalsReporter() {
  const queue = useRef<WebVitalMetric[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const metrics = queue.current.splice(0);
    if (metrics.length) send(metrics);
  };
  useReportWebVitals((metric) => {
    if (!TRACKED.has(metric.name)) return;
    queue.current.push(metric);
    if (!timer.current) timer.current = setTimeout(flush, 250);
  });
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  });
  return null;
}
