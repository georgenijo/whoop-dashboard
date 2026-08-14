import { requireAuth } from "@/lib/auth";
import { addSyncLog } from "@/lib/db";
import { runWhoopSync } from "@/lib/sync";
import { PARTIAL_ERROR_FALLBACK } from "@/lib/sync-meta";

export const dynamic = "force-dynamic";

// Near-copy of /api/sync. Two intentional differences:
//   1. NO `SYNC_COOLDOWN_MS` skip block — the welcome wizard runs immediately
//      after Whoop OAuth, and the cooldown gate (designed to prevent
//      hammer-clicking the manual button) would skip a sync the user is
//      literally watching the spinner for.
//   2. `source: "onboarding"` on sync_logs so the Logs page can distinguish
//      wizard runs from manual button presses + webhook-driven syncs.
const SYNC_TIMEOUT_MS = 120_000;

export async function POST(req: Request) {
  const { user } = await requireAuth(req);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), SYNC_TIMEOUT_MS);

  const composite = new AbortController();
  const onUpstreamAbort = () => composite.abort(timeoutCtrl.signal.reason);
  const onRequestAbort = () => composite.abort(req.signal.reason);
  if (timeoutCtrl.signal.aborted) onUpstreamAbort();
  else timeoutCtrl.signal.addEventListener("abort", onUpstreamAbort, { once: true });
  if (req.signal.aborted) onRequestAbort();
  else req.signal.addEventListener("abort", onRequestAbort, { once: true });

  let result;
  try {
    result = await runWhoopSync({ userId: user.id, signal: composite.signal });
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - t0;

  if (result.success) {
    addSyncLog({
      user_id: user.id,
      started_at: startedAt,
      duration_ms: durationMs,
      status: "ok",
      recovery_count: result.fetched_counts.recovery,
      sleep_count: result.fetched_counts.sleep,
      workouts_count: result.fetched_counts.workouts,
      error_message: result.partial
        ? (result.error ?? PARTIAL_ERROR_FALLBACK).slice(0, 800)
        : null,
      source: "onboarding",
      details: JSON.stringify({
        ...result.details,
        rows_inserted: result.rows_inserted,
        fetched_counts: result.fetched_counts,
        latest_recovery_date: result.latest_recovery_date,
        latest_sleep_date: result.latest_sleep_date,
        latest_strain_date: result.latest_strain_date,
      }),
      partial: result.partial === true,
    });
    return Response.json({
      ok: true,
      durationMs,
      recovery: result.fetched_counts.recovery,
      sleep: result.fetched_counts.sleep,
      workouts: result.fetched_counts.workouts,
    });
  }

  const errorMsg = (result.error ?? "sync failed").slice(0, 800);
  addSyncLog({
    user_id: user.id,
    started_at: startedAt,
    duration_ms: durationMs,
    status: "error",
    recovery_count: result.fetched_counts.recovery,
    sleep_count: result.fetched_counts.sleep,
    workouts_count: result.fetched_counts.workouts,
    error_message: errorMsg,
    source: "onboarding",
    details: JSON.stringify({
      ...result.details,
      rows_inserted: result.rows_inserted,
      fetched_counts: result.fetched_counts,
    }),
    partial: false,
  });
  return Response.json({ ok: false, error: errorMsg, durationMs }, { status: 500 });
}
