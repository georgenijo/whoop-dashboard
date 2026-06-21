import { requireAuth } from "@/lib/auth";
import {
  insertPerfMetric,
  PERF_METRICS,
  type PerfMetricName,
  type PerfRating,
  type PerfSource,
} from "@/lib/db/perf";
import { forModule } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = forModule("api.perf");

// Frontend Web Vitals ingestion. Web (and later iOS) POST metric samples here.
//   - Auth required (Bearer or cookie).
//   - Per-user rate limit: 20 events/sec token bucket. A page load fires ~5–6
//     vitals plus route-change metrics, so the ceiling is generous but bounded.
//   - Manual schema validation (no zod for one route), same as /api/log/client.

const VALID_SOURCES: PerfSource[] = ["web", "ios"];
const VALID_METRICS = new Set<string>(PERF_METRICS);
const VALID_RATINGS: PerfRating[] = ["good", "needs-improvement", "poor"];

type Bucket = { tokens: number; lastRefill: number };
const buckets = new Map<number, Bucket>();
const REFILL_PER_MS = 20 / 1000;
const MAX_TOKENS = 20;
const BUCKET_TTL_MS = 60_000;

function takeToken(userId: number): boolean {
  const now = Date.now();
  // Lazy eviction so the per-user bucket map can't grow unbounded across many
  // tenants. Only sweeps once the map is non-trivially large.
  if (buckets.size > 1000) {
    for (const [id, bucket] of buckets) {
      if (now - bucket.lastRefill > BUCKET_TTL_MS) buckets.delete(id);
    }
  }
  const b = buckets.get(userId) ?? { tokens: MAX_TOKENS, lastRefill: now };
  const elapsed = now - b.lastRefill;
  b.tokens = Math.min(MAX_TOKENS, b.tokens + elapsed * REFILL_PER_MS);
  b.lastRefill = now;
  if (b.tokens < 1) {
    buckets.set(userId, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(userId, b);
  return true;
}

type Payload = {
  source?: unknown;
  metric?: unknown;
  value?: unknown;
  rating?: unknown;
  path?: unknown;
  navigation_type?: unknown;
  app_version?: unknown;
};

function isString(x: unknown): x is string {
  return typeof x === "string";
}

export async function POST(req: Request) {
  let auth;
  try {
    auth = await requireAuth(req);
  } catch (err) {
    if (err instanceof Response) return err;
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = auth.user.id;

  if (!takeToken(userId)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  if (!isString(body.source) || !VALID_SOURCES.includes(body.source as PerfSource)) {
    return Response.json({ ok: false, error: "bad_source" }, { status: 400 });
  }
  if (!isString(body.metric) || !VALID_METRICS.has(body.metric)) {
    return Response.json({ ok: false, error: "bad_metric" }, { status: 400 });
  }
  if (typeof body.value !== "number" || !Number.isFinite(body.value) || body.value < 0) {
    return Response.json({ ok: false, error: "bad_value" }, { status: 400 });
  }
  if (
    body.rating !== undefined &&
    body.rating !== null &&
    !(isString(body.rating) && VALID_RATINGS.includes(body.rating as PerfRating))
  ) {
    return Response.json({ ok: false, error: "bad_rating" }, { status: 400 });
  }

  try {
    insertPerfMetric({
      source: body.source as PerfSource,
      metric: body.metric as PerfMetricName,
      value: body.value,
      rating: isString(body.rating) ? (body.rating as PerfRating) : null,
      path: isString(body.path) ? body.path : null,
      navigation_type: isString(body.navigation_type) ? body.navigation_type : null,
      user_id: userId,
      user_agent: req.headers.get("user-agent"),
      app_version: isString(body.app_version) ? body.app_version : null,
    });
  } catch (err) {
    log.error({ user_id: userId, err: String(err) }, "insertPerfMetric failed");
    return Response.json({ ok: false, error: "insert_failed" }, { status: 500 });
  }

  return new Response(null, { status: 204 });
}
