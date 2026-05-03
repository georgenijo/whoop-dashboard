import { clientSecret } from "@/lib/auth";
import { addSyncLog } from "@/lib/db";
import {
  whoopGet,
  WhoopAuthError,
  WhoopNotFoundError,
  WhoopRecoveryListMissError,
  WhoopUpstreamError,
} from "@/lib/whoop/client";
import { verifyWhoopSignature } from "@/lib/whoop/signature";
import {
  deleteRecoveryAndRecompute,
  deleteSleepAndRecompute,
  deleteWorkoutAndRecompute,
  recomputeDailySummary,
  recoverySummaryDate,
  sleepSummaryDate,
  upsertRecovery,
  upsertSleep,
  upsertWorkout,
  workoutSummaryDate,
  type WhoopRecoveryRecord,
  type WhoopSleepRecord,
  type WhoopWorkoutRecord,
} from "@/lib/whoop/upsert";

export const dynamic = "force-dynamic";

type WebhookEvent = {
  user_id: number;
  id: string;
  type: string;
  trace_id?: string;
};

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
    // Include req.url to aid misconfig debugging (e.g. path registered wrong in Whoop dashboard).
    console.warn(`[whoop-webhook] signature rejected: ${verify.reason} url=${req.url}`);
    return new Response(`Unauthorized: ${verify.reason}`, { status: 401 });
  }

  let evt: WebhookEvent;
  try {
    evt = JSON.parse(raw) as WebhookEvent;
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

  try {
    switch (evt.type) {
      case "sleep.updated": {
        const r = await whoopGet<WhoopSleepRecord>(`/v2/activity/sleep/${evt.id}`);
        upsertSleep(r);
        recomputeDailySummary(sleepSummaryDate(r));
        break;
      }
      case "workout.updated": {
        const r = await whoopGet<WhoopWorkoutRecord>(`/v2/activity/workout/${evt.id}`);
        upsertWorkout(r);
        recomputeDailySummary(workoutSummaryDate(r));
        break;
      }
      case "recovery.updated": {
        const list = await whoopGet<{ records: WhoopRecoveryRecord[] }>(
          "/v2/recovery?limit=10",
        );
        const r = list.records.find((x) => x.sleep_id === evt.id);
        if (!r) {
          // Record not yet in latest 10 — likely a scoring race. 502 → Whoop retries.
          throw new WhoopRecoveryListMissError(
            `recovery sleep_id=${evt.id} not in latest 10`,
          );
        }
        upsertRecovery(r);
        recomputeDailySummary(recoverySummaryDate(r));
        break;
      }
      case "sleep.deleted": {
        const date = deleteSleepAndRecompute(evt.id);
        if (!date) {
          logWebhook({
            startedAt,
            durationMs: Date.now() - t0,
            status: "ok",
            details: { ...baseDetails, note: "already_deleted" },
          });
          return new Response("ok", { status: 200 });
        }
        break;
      }
      case "workout.deleted": {
        const date = deleteWorkoutAndRecompute(evt.id);
        if (!date) {
          logWebhook({
            startedAt,
            durationMs: Date.now() - t0,
            status: "ok",
            details: { ...baseDetails, note: "already_deleted" },
          });
          return new Response("ok", { status: 200 });
        }
        break;
      }
      case "recovery.deleted": {
        const date = deleteRecoveryAndRecompute(evt.id);
        if (!date) {
          logWebhook({
            startedAt,
            durationMs: Date.now() - t0,
            status: "ok",
            details: { ...baseDetails, note: "already_deleted" },
          });
          return new Response("ok", { status: 200 });
        }
        break;
      }
      default: {
        logWebhook({
          startedAt,
          durationMs: Date.now() - t0,
          status: "ok",
          details: { ...baseDetails, note: "unknown_event_type" },
        });
        return new Response("ok", { status: 200 });
      }
    }

    logWebhook({
      startedAt,
      durationMs: Date.now() - t0,
      status: "ok",
      details: baseDetails,
    });
    return new Response("ok", { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 404 from Whoop = resource permanently absent; discard silently, don't retry.
    // Everything else = transient (upstream error, network, timeout, recovery list miss,
    // auth failure) → 502 so Whoop retries up to 5×.
    const isHandledMiss = err instanceof WhoopNotFoundError;
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
