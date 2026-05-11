import "server-only";
import { lookupUserIdByProvider } from "@/lib/db/integrations";
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
 * had, or an event for a Whoop user we don't have a mapping for yet). The
 * caller maps these to the webhook_events status — all noop reasons here
 * resolve to "succeeded" so Whoop doesn't retry. */
export type HandleEventOutcome =
  | { kind: "handled" }
  | {
      kind: "noop";
      reason:
        | "already_deleted"
        | "unknown_event_type"
        | "unknown_whoop_user"
        | "missing_whoop_user_id";
    };

/** Surfaces `WhoopNotFoundError` raw because callers handle it differently
 * (webhook route discards; replay marks discarded). */
export async function handleEvent(evt: WhoopWebhookEvent): Promise<HandleEventOutcome> {
  // Phase D — resolve the Whoop user_id from the event payload to a local
  // users.id row via the integrations.provider_user_id mapping. If we can't
  // resolve, return a 200 noop so Whoop doesn't retry forever.
  if (evt.user_id == null) {
    return { kind: "noop", reason: "missing_whoop_user_id" };
  }
  const userId = lookupUserIdByProvider("whoop", String(evt.user_id));
  if (userId === null) {
    return { kind: "noop", reason: "unknown_whoop_user" };
  }

  switch (evt.type) {
    case "sleep.updated": {
      const r = await whoopGet<WhoopSleepRecord>(`/v2/activity/sleep/${evt.id}`, { userId });
      upsertSleep(r, userId);
      recomputeDailySummary(sleepSummaryDate(r), userId);
      return { kind: "handled" };
    }
    case "workout.updated": {
      const r = await whoopGet<WhoopWorkoutRecord>(`/v2/activity/workout/${evt.id}`, { userId });
      upsertWorkout(r, userId);
      recomputeDailySummary(workoutSummaryDate(r), userId);
      return { kind: "handled" };
    }
    case "recovery.updated": {
      const list = await whoopGet<{ records: WhoopRecoveryRecord[] }>(
        "/v2/recovery?limit=10",
        { userId },
      );
      const r = list.records.find((x) => x.sleep_id === evt.id);
      if (!r) {
        // Record not yet in latest 10 — likely a scoring race. Throw so caller
        // returns 502; Whoop will retry.
        throw new WhoopRecoveryListMissError(
          `recovery sleep_id=${evt.id} not in latest 10`,
        );
      }
      upsertRecovery(r, userId);
      recomputeDailySummary(recoverySummaryDate(r), userId);
      return { kind: "handled" };
    }
    case "sleep.deleted": {
      const date = deleteSleepAndRecompute(evt.id, userId);
      if (!date) return { kind: "noop", reason: "already_deleted" };
      return { kind: "handled" };
    }
    case "workout.deleted": {
      const date = deleteWorkoutAndRecompute(evt.id, userId);
      if (!date) return { kind: "noop", reason: "already_deleted" };
      return { kind: "handled" };
    }
    case "recovery.deleted": {
      const date = deleteRecoveryAndRecompute(evt.id, userId);
      if (!date) return { kind: "noop", reason: "already_deleted" };
      return { kind: "handled" };
    }
    default:
      return { kind: "noop", reason: "unknown_event_type" };
  }
}
