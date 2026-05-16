import { clientSecret } from "@/lib/auth";
import {
  addSyncLog,
  insertWebhookEvent,
  markWebhookDiscarded,
  markWebhookFailed,
  markWebhookSucceeded,
} from "@/lib/db";
import { WhoopNotFoundError } from "@/lib/whoop/client";
import { verifyWhoopSignature } from "@/lib/whoop/signature";
import { handleEvent, type WhoopWebhookEvent } from "@/lib/whoop/webhook-handler";
import { forModule } from "@/lib/logger";

const log = forModule("whoop.webhook");

export const dynamic = "force-dynamic";

function logWebhook(args: {
  startedAt: string;
  durationMs: number;
  status: "ok" | "error";
  details: Record<string, unknown>;
  error?: string | null;
}) {
  addSyncLog({
    started_at: args.startedAt,
    duration_ms: args.durationMs,
    status: args.status,
    recovery_count: null,
    sleep_count: null,
    workouts_count: null,
    error_message: args.error ?? null,
    source: "webhook",
    details: JSON.stringify(args.details),
    partial: false,
  });
}

export async function POST(req: Request) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const raw = await req.text();
  const sig = req.headers.get("x-whoop-signature");
  const ts = req.headers.get("x-whoop-signature-timestamp");

  const verify = verifyWhoopSignature(raw, sig, ts, clientSecret());
  if (!verify.ok) {
    // Bad-sig events are not persisted in v1.
    log.warn({ reason: verify.reason, url: req.url }, "signature rejected");
    return new Response(`Unauthorized: ${verify.reason}`, { status: 401 });
  }

  let evt: WhoopWebhookEvent;
  try {
    evt = JSON.parse(raw) as WhoopWebhookEvent;
  } catch {
    logWebhook({
      startedAt,
      durationMs: Date.now() - t0,
      status: "error",
      details: { reason: "malformed_json" },
      error: "Malformed JSON",
    });
    return new Response("Bad Request", { status: 400 });
  }

  if (!evt.type || !evt.id) {
    logWebhook({
      startedAt,
      durationMs: Date.now() - t0,
      status: "error",
      details: { reason: "missing_fields", evt },
      error: "Missing type or id",
    });
    return new Response("Bad Request", { status: 400 });
  }

  const baseDetails = {
    event_type: evt.type,
    resource_id: evt.id,
    trace_id: evt.trace_id ?? null,
  };

  // DLQ row: created BEFORE dispatch so a handler that crashes mid-flight
  // still leaves a durable record. dlqId may be null if the DB is unreachable
  // (treat that as soft-fail — we still want to attempt dispatch and return
  // a useful status to Whoop). Every status update below is a no-op if null.
  const dlqId = insertWebhookEvent({
    received_at: startedAt,
    event_type: evt.type,
    resource_id: evt.id,
    trace_id: evt.trace_id ?? null,
    payload: raw,
    attempts: 1,
    last_attempt_at: startedAt,
  });

  try {
    const outcome = await handleEvent(evt);
    const finishedAt = new Date().toISOString();
    if (dlqId !== null) markWebhookSucceeded(dlqId, finishedAt);
    if (outcome.kind === "noop") {
      logWebhook({
        startedAt,
        durationMs: Date.now() - t0,
        status: "ok",
        details: { ...baseDetails, note: outcome.reason },
      });
    } else {
      logWebhook({
        startedAt,
        durationMs: Date.now() - t0,
        status: "ok",
        details: baseDetails,
      });
    }
    return new Response("ok", { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 404 from Whoop = resource permanently absent; discard silently, don't retry.
    // Everything else → 502 so Whoop retries up to 5× with backoff. The DLQ row
    // is the durable record of any handler exception — failed rows are
    // replayable via /api/admin/webhook/replay once the cause is fixed.
    const isHandledMiss = err instanceof WhoopNotFoundError;
    const finishedAt = new Date().toISOString();
    if (dlqId !== null) {
      if (isHandledMiss) {
        markWebhookDiscarded(dlqId, finishedAt);
      } else {
        markWebhookFailed(dlqId, msg, finishedAt);
      }
    }
    logWebhook({
      startedAt,
      durationMs: Date.now() - t0,
      status: "error",
      details: { ...baseDetails, error: msg, handled_miss: isHandledMiss },
      error: msg.slice(0, 800),
    });
    if (isHandledMiss) return new Response("ok (resource missing)", { status: 200 });
    return new Response(msg.slice(0, 200), { status: 502 });
  }
}
