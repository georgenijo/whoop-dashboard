import { requireAuth } from "@/lib/auth";
import { addSyncLog, getLastSuccessfulSyncAt } from "@/lib/db";
import { runWhoopSync, SYNC_COOLDOWN_MS } from "@/lib/sync";
import { PARTIAL_ERROR_FALLBACK } from "@/lib/sync-meta";

export const dynamic = "force-dynamic";

const SYNC_TIMEOUT_MS = 120_000;

export async function POST(req: Request) {
  const { user } = await requireAuth(req);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  // No sync_logs row on skip — keeps history clean.
  // Best-effort gate, not a lock — ok for manual button cadence.
  const lastOk = getLastSuccessfulSyncAt();
  if (lastOk && Date.now() - lastOk.getTime() < SYNC_COOLDOWN_MS) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: "recent_sync",
      lastSyncAt: lastOk.toISOString(),
    });
  }

  // 120s timeout matches the previous Python subprocess SIGTERM ceiling.
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), SYNC_TIMEOUT_MS);

  // Honor the request's own AbortSignal (if any) alongside our timeout.
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
      started_at: startedAt,
      duration_ms: durationMs,
      status: "ok",
      // Match Python sync_logs semantics — total records returned by the API.
      // Per-endpoint inserted counts are in `details.rows_inserted`.
      recovery_count: result.fetched_counts.recovery,
      sleep_count: result.fetched_counts.sleep,
      workouts_count: result.fetched_counts.workouts,
      error_message: result.partial
        ? (result.error ?? PARTIAL_ERROR_FALLBACK).slice(0, 800)
        : null,
      source: "manual",
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
    started_at: startedAt,
    duration_ms: durationMs,
    status: "error",
    recovery_count: result.fetched_counts.recovery,
    sleep_count: result.fetched_counts.sleep,
    workouts_count: result.fetched_counts.workouts,
    error_message: errorMsg,
    source: "manual",
    details: JSON.stringify({
      ...result.details,
      rows_inserted: result.rows_inserted,
      fetched_counts: result.fetched_counts,
    }),
    partial: false,
  });
  return Response.json({ ok: false, error: errorMsg, durationMs }, { status: 500 });
}
