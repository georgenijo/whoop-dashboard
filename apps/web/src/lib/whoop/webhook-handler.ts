import "server-only";
import { whoopGet, WhoopRecoveryListMissError } from "./client";
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
} from "./upsert";

export type WhoopWebhookEvent = {
  user_id?: number;
  id: string;
  type: string;
  trace_id?: string;
};

/** Result of dispatching one webhook event. `noop` means the event was
 * accepted and required no DB change (e.g. a delete for a record we never
 * had). `handled` means upsert/delete ran. The caller maps these to the
 * webhook_events status — both are "succeeded". */
export type HandleEventOutcome =
  | { kind: "handled" }
  | { kind: "noop"; reason: "already_deleted" | "unknown_event_type" };

/**
 * Re-dispatch a single Whoop webhook event. Decoupled from request/response so
 * it can be reused by the replay endpoint. Throws on transient failure
 * (Whoop 5xx, list-miss race, DB error, etc.). `WhoopNotFoundError` from the
 * client is caller-discardable — surface it raw and let the caller decide
 * whether to mark `discarded`.
 */
export async function handleEvent(evt: WhoopWebhookEvent): Promise<HandleEventOutcome> {
  switch (evt.type) {
    case "sleep.updated": {
      const r = await whoopGet<WhoopSleepRecord>(`/v2/activity/sleep/${evt.id}`);
      upsertSleep(r);
      recomputeDailySummary(sleepSummaryDate(r));
      return { kind: "handled" };
    }
    case "workout.updated": {
      const r = await whoopGet<WhoopWorkoutRecord>(`/v2/activity/workout/${evt.id}`);
      upsertWorkout(r);
      recomputeDailySummary(workoutSummaryDate(r));
      return { kind: "handled" };
    }
    case "recovery.updated": {
      const list = await whoopGet<{ records: WhoopRecoveryRecord[] }>(
        "/v2/recovery?limit=10",
      );
      const r = list.records.find((x) => x.sleep_id === evt.id);
      if (!r) {
        // Record not yet in latest 10 — likely a scoring race. Throw so caller
        // returns 502; Whoop will retry.
        throw new WhoopRecoveryListMissError(
          `recovery sleep_id=${evt.id} not in latest 10`,
        );
      }
      upsertRecovery(r);
      recomputeDailySummary(recoverySummaryDate(r));
      return { kind: "handled" };
    }
    case "sleep.deleted": {
      const date = deleteSleepAndRecompute(evt.id);
      if (!date) return { kind: "noop", reason: "already_deleted" };
      return { kind: "handled" };
    }
    case "workout.deleted": {
      const date = deleteWorkoutAndRecompute(evt.id);
      if (!date) return { kind: "noop", reason: "already_deleted" };
      return { kind: "handled" };
    }
    case "recovery.deleted": {
      const date = deleteRecoveryAndRecompute(evt.id);
      if (!date) return { kind: "noop", reason: "already_deleted" };
      return { kind: "handled" };
    }
    default:
      return { kind: "noop", reason: "unknown_event_type" };
  }
}
