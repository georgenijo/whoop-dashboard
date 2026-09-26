import "server-only";
import { openWrite, type DB } from "@/lib/db/connection";
import { parseDate, type WhoopCycleRecord } from "./upsert";

/**
 * Persist the step count independently of cycle strain scoring. WHOOP counts
 * physiological cycles; `date` is the user's local `created_at` day (when
 * WHOOP recorded the cycle after waking), falling back to local start day
 * only for older payloads without `created_at`. The actual bounds remain on
 * every row so consumers can identify partial and non-calendar totals.
 *
 * A supplied write handle joins the caller's transaction. No second writer
 * is opened during full sync or cycle reconciliation.
 */
export function upsertWhoopCycleSteps(
  record: WhoopCycleRecord,
  userId: number,
  tz: string,
  writeDb?: DB,
): boolean {
  if (!Number.isSafeInteger(record.id) || !record.id || record.id <= 0) return false;
  const steps = record.step_count ?? null;
  if (steps !== null && (!Number.isInteger(steps) || steps < 0)) {
    throw new Error(`Invalid step_count for WHOOP cycle ${record.id}`);
  }
  const db = writeDb ?? openWrite();
  if (!db) return false;
  try {
    db.prepare(`
      INSERT INTO whoop_cycle_steps
        (user_id, cycle_id, date, cycle_start, cycle_end, score_state,
         step_count, upstream_updated_at, fetched_at)
      VALUES
        (@user_id, @cycle_id, @date, @cycle_start, @cycle_end, @score_state,
         @step_count, @upstream_updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(user_id, cycle_id) DO UPDATE SET
        date = excluded.date,
        cycle_start = excluded.cycle_start,
        cycle_end = excluded.cycle_end,
        score_state = excluded.score_state,
        step_count = excluded.step_count,
        upstream_updated_at = excluded.upstream_updated_at,
        fetched_at = excluded.fetched_at
      WHERE whoop_cycle_steps.upstream_updated_at IS NULL
         OR excluded.upstream_updated_at IS NULL
         OR excluded.upstream_updated_at >= whoop_cycle_steps.upstream_updated_at
    `).run({
      user_id: userId,
      cycle_id: record.id,
      date: parseDate(record.created_at || record.start, tz),
      cycle_start: record.start,
      cycle_end: record.end ?? null,
      score_state: record.score_state ?? null,
      step_count: steps,
      upstream_updated_at: record.updated_at ?? null,
    });
    return true;
  } finally {
    if (!writeDb) db.close();
  }
}
