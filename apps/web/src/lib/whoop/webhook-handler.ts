import "server-only";
import { getUserSettings } from "@/lib/db";
import { lookupUserIdByProvider } from "@/lib/db/integrations";
import { whoopGet, WhoopRecoveryListMissError } from "./client";
import {
  deleteRecoveryAndRecompute,
  deleteSleepAndRecompute,
  deleteWorkoutAndRecompute,
  getSleepDate,
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

/**
 * Map a webhook payload's Whoop `user_id` onto a local `users.id`, or null
 * when the event carries no Whoop user or we hold no mapping for it.
 *
 * Exported (issue #494) so the route can stamp the tenant onto its
 * `sync_logs` row on EVERY path — including the one where `handleEvent`
 * throws and therefore returns no outcome to read the id off of. It's a
 * single indexed lookup, so paying for it twice per delivery is cheaper than
 * threading a resolved id through the throw.
 */
export function resolveEventUserId(evt: WhoopWebhookEvent): number | null {
  if (evt.user_id == null) return null;
  return lookupUserIdByProvider("whoop", String(evt.user_id));
}

/** Surfaces `WhoopNotFoundError` raw because callers handle it differently
 * (webhook route discards; replay marks discarded). */
export async function handleEvent(evt: WhoopWebhookEvent): Promise<HandleEventOutcome> {
  // Phase D — resolve the Whoop user_id from the event payload to a local
  // users.id row via the integrations.provider_user_id mapping. If we can't
  // resolve, return a 200 noop so Whoop doesn't retry forever.
  if (evt.user_id == null) {
    return { kind: "noop", reason: "missing_whoop_user_id" };
  }
  const userId = resolveEventUserId(evt);
  if (userId === null) {
    return { kind: "noop", reason: "unknown_whoop_user" };
  }
  const userSettings = getUserSettings(userId);
  const tz = userSettings?.tz ?? "UTC";

  switch (evt.type) {
    case "sleep.updated": {
      const r = await whoopGet<WhoopSleepRecord>(`/v2/activity/sleep/${evt.id}`, { userId });
      // Gate BEFORE touching date logic at all — mirrors upsertSleep's own
      // guard. Not yet scored (or no score payload) means upsertSleep is a
      // no-op, so there's nothing to re-date or recompute. This also keeps
      // `sleepSummaryDate` (which throws when `end` is missing, issue #440)
      // away from a PENDING_SCORE record that may not carry `end` yet —
      // un-gated, that throw would turn a webhook we should accept as a
      // no-op into a 502, and Whoop's 5 retries into a DLQ `failed` row
      // (issue #440 review, second pass, WARN 3).
      if (r.score_state !== "SCORED" || !r.score) {
        return { kind: "handled" };
      }
      // Read the row's CURRENT date BEFORE the upsert overwrites it — a row
      // already on a different date (e.g. a legacy row still on its
      // pre-migration start-day date, the first time this webhook touches
      // it post-deploy) leaves that date's `daily_summary` stale the moment
      // the upsert moves it, and needs its own recompute (issue #440
      // review, BLOCK 5). Not just an optimization: without this, the
      // vacated date silently keeps stale sleep_hours/efficiency/
      // performance from a sleep that has since moved to another date.
      const oldDate = getSleepDate(r.id, userId);
      upsertSleep(r, userId, tz);
      const newDate = sleepSummaryDate(r, tz);
      recomputeDailySummary(newDate, userId);
      if (oldDate && oldDate !== newDate) recomputeDailySummary(oldDate, userId);
      return { kind: "handled" };
    }
    case "workout.updated": {
      const r = await whoopGet<WhoopWorkoutRecord>(`/v2/activity/workout/${evt.id}`, { userId });
      upsertWorkout(r, userId, tz);
      recomputeDailySummary(workoutSummaryDate(r, tz), userId);
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
      upsertRecovery(r, userId, tz);
      recomputeDailySummary(recoverySummaryDate(r, tz), userId);
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
