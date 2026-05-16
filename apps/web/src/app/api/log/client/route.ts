import { requireAuth } from "@/lib/auth";
import {
  insertClientLog,
  type ClientLogKind,
  type ClientLogLevel,
  type ClientLogSource,
} from "@/lib/db/client-logs";
import { forModule } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = forModule("api.log.client");

// Issue #388 — client log ingestion. Web + iOS POST here.
//   - Auth required (Bearer or cookie).
//   - Per-user rate limit: 10 events/sec, in-memory token bucket. Drops 11th
//     with 429. Suitable for personal-use scale; revisit at multi-tenant.
//   - Schema-validate the body manually to avoid pulling zod for one route.

const VALID_SOURCES: ClientLogSource[] = ["web", "ios"];
const VALID_LEVELS: ClientLogLevel[] = ["info", "warn", "error"];
const VALID_KINDS: ClientLogKind[] = [
  "error",
  "pageview",
  "click",
  "lifecycle",
  "event",
];

type Bucket = { tokens: number; lastRefill: number };
const buckets = new Map<number, Bucket>();
const REFILL_PER_MS = 10 / 1000;
const MAX_TOKENS = 10;

function takeToken(userId: number): boolean {
  const now = Date.now();
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
  level?: unknown;
  kind?: unknown;
  message?: unknown;
  details?: unknown;
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

  if (!isString(body.source) || !VALID_SOURCES.includes(body.source as ClientLogSource)) {
    return Response.json({ ok: false, error: "bad_source" }, { status: 400 });
  }
  if (!isString(body.level) || !VALID_LEVELS.includes(body.level as ClientLogLevel)) {
    return Response.json({ ok: false, error: "bad_level" }, { status: 400 });
  }
  if (!isString(body.kind) || !VALID_KINDS.includes(body.kind as ClientLogKind)) {
    return Response.json({ ok: false, error: "bad_kind" }, { status: 400 });
  }
  if (!isString(body.message) || body.message.length === 0) {
    return Response.json({ ok: false, error: "bad_message" }, { status: 400 });
  }

  let detailsString: string | null = null;
  if (body.details !== undefined && body.details !== null) {
    try {
      detailsString =
        typeof body.details === "string"
          ? body.details
          : JSON.stringify(body.details);
    } catch {
      return Response.json({ ok: false, error: "bad_details" }, { status: 400 });
    }
  }

  try {
    insertClientLog({
      source: body.source as ClientLogSource,
      level: body.level as ClientLogLevel,
      kind: body.kind as ClientLogKind,
      message: body.message,
      details: detailsString,
      user_id: userId,
      user_agent: req.headers.get("user-agent"),
      app_version: isString(body.app_version) ? body.app_version : null,
    });
  } catch (err) {
    log.error(
      { user_id: userId, err: String(err) },
      "insertClientLog failed",
    );
    return Response.json({ ok: false, error: "insert_failed" }, { status: 500 });
  }

  return new Response(null, { status: 204 });
}
