import "server-only";
import { openWrite, safeQuery, type DB } from "./connection";

// Frontend performance telemetry. Web Vitals (and the equivalent metrics from
// other clients) POST to /api/perf, land here, and are read by the /perf page.
// Mirrors the client_logs storage pattern (see ./client-logs.ts).

export type PerfSource = "web" | "ios";

// Core Web Vitals plus the timing metrics web-vitals reports. Anything not in
// this set is rejected at ingest so the table stays a known shape.
export const PERF_METRICS = [
  "LCP",
  "INP",
  "CLS",
  "FCP",
  "TTFB",
  "FID",
] as const;
export type PerfMetricName = (typeof PERF_METRICS)[number];

export type PerfRating = "good" | "needs-improvement" | "poor";

export type PerfMetricInsert = {
  source: PerfSource;
  metric: PerfMetricName;
  value: number;
  rating?: PerfRating | null;
  path?: string | null;
  navigation_type?: string | null;
  user_id: number;
  user_agent?: string | null;
  app_version?: string | null;
};

export type PerfMetricRow = {
  id: number;
  created_at: string;
  source: PerfSource;
  metric: string;
  value: number;
  rating: string | null;
  path: string | null;
  navigation_type: string | null;
  user_id: number;
  user_agent: string | null;
  app_version: string | null;
};

const PATH_TRUNCATE = 512;
const UA_TRUNCATE = 512;

function truncate(s: string | null | undefined, n: number): string | null {
  if (s == null) return null;
  return s.length > n ? s.slice(0, n) : s;
}

export function insertPerfMetric(row: PerfMetricInsert): void {
  const db: DB | null = openWrite();
  if (!db) return;
  try {
    db.prepare(
      `INSERT INTO perf_metrics
         (created_at, source, metric, value, rating, path, navigation_type, user_id, user_agent, app_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      new Date().toISOString(),
      row.source,
      row.metric,
      row.value,
      row.rating ?? null,
      truncate(row.path ?? null, PATH_TRUNCATE),
      truncate(row.navigation_type ?? null, 32),
      row.user_id,
      truncate(row.user_agent ?? null, UA_TRUNCATE),
      truncate(row.app_version ?? null, 64),
    );
  } finally {
    db.close();
  }
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  // Nearest-rank: index of the smallest value at or above the p-th percentile.
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const idx = Math.min(Math.max(rank - 1, 0), sortedAsc.length - 1);
  return sortedAsc[idx];
}

export type PerfMetricSummary = {
  metric: string;
  count: number;
  p75: number;
  p95: number;
  good: number;
  needs_improvement: number;
  poor: number;
};

/**
 * Per-metric rollup over the trailing `sinceDays` window for one user. p75 is
 * the headline Web Vitals statistic; rating buckets are taken from the values
 * the client reported (web-vitals computes them against Google's thresholds).
 */
export function getPerfSummary(userId: number, sinceDays = 30): PerfMetricSummary[] {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  return (
    safeQuery((db) => {
      const rows = db
        .prepare(
          `SELECT metric, value, rating FROM perf_metrics
           WHERE user_id = ? AND created_at >= ?`,
        )
        .all(userId, since) as { metric: string; value: number; rating: string | null }[];

      const byMetric = new Map<string, { values: number[]; ratings: (string | null)[] }>();
      for (const r of rows) {
        const entry = byMetric.get(r.metric) ?? { values: [], ratings: [] };
        entry.values.push(r.value);
        entry.ratings.push(r.rating);
        byMetric.set(r.metric, entry);
      }

      const out: PerfMetricSummary[] = [];
      for (const metric of PERF_METRICS) {
        const entry = byMetric.get(metric);
        if (!entry || entry.values.length === 0) continue;
        const sorted = [...entry.values].sort((a, b) => a - b);
        out.push({
          metric,
          count: sorted.length,
          p75: percentile(sorted, 75),
          p95: percentile(sorted, 95),
          good: entry.ratings.filter((x) => x === "good").length,
          needs_improvement: entry.ratings.filter((x) => x === "needs-improvement").length,
          poor: entry.ratings.filter((x) => x === "poor").length,
        });
      }
      return out;
    }) ?? []
  );
}

export type PerfDailyPoint = { day: string; p75: number; count: number };

/** Daily p75 series for a single metric — drives the trend chart on /perf. */
export function getPerfDaily(
  userId: number,
  metric: PerfMetricName,
  sinceDays = 30,
): PerfDailyPoint[] {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  return (
    safeQuery((db) => {
      const rows = db
        .prepare(
          `SELECT substr(created_at, 1, 10) AS day, value FROM perf_metrics
           WHERE user_id = ? AND metric = ? AND created_at >= ?
           ORDER BY created_at ASC`,
        )
        .all(userId, metric, since) as { day: string; value: number }[];

      const byDay = new Map<string, number[]>();
      for (const r of rows) {
        const list = byDay.get(r.day) ?? [];
        list.push(r.value);
        byDay.set(r.day, list);
      }
      return Array.from(byDay.entries()).map(([day, values]) => {
        const sorted = values.sort((a, b) => a - b);
        return { day, p75: percentile(sorted, 75), count: sorted.length };
      });
    }) ?? []
  );
}

export function recentPerfMetrics(userId: number, limit = 100): PerfMetricRow[] {
  const safe = Math.min(Math.max(limit, 1), 1000);
  return (
    safeQuery((db) =>
      db
        .prepare(
          `SELECT id, created_at, source, metric, value, rating, path, navigation_type,
                  user_id, user_agent, app_version
           FROM perf_metrics
           WHERE user_id = ?
           ORDER BY id DESC LIMIT ${safe}`,
        )
        .all(userId) as PerfMetricRow[],
    ) ?? []
  );
}
