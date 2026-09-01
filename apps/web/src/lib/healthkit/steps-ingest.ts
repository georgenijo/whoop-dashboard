import "server-only";
import { openWrite } from "@/lib/db/connection";

// HealthKit daily step ingestion. Writes to `daily_steps`; reads for coach/UI
// route through `forUser()` in db/steps.ts. On the scoped.test.ts allowlist.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type HealthKitStepsInput = {
  date: string;
  steps: number;
};

export type StepsIngestResult = {
  upserted: number;
  skipped: number;
};

function validate(row: unknown): HealthKitStepsInput | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  const date = typeof o.date === "string" ? o.date.trim() : "";
  if (!DATE_RE.test(date)) return null;
  const steps = typeof o.steps === "number" && Number.isFinite(o.steps) ? o.steps : null;
  if (steps == null || steps < 0) return null;
  return { date, steps: Math.round(steps) };
}

/**
 * Upsert daily step totals from Apple Health for `userId`. Idempotent on
 * replay — re-sending the same date overwrites with the latest count.
 */
export function ingestHealthKitSteps(
  rows: unknown[],
  userId: number,
): StepsIngestResult {
  const result: StepsIngestResult = { upserted: 0, skipped: 0 };
  if (!Array.isArray(rows) || rows.length === 0) return result;

  const db = openWrite();
  if (!db) throw new Error("DB unavailable (no whoop_data.db at expected path)");

  const stmt = db.prepare(`
    INSERT INTO daily_steps (user_id, date, steps, source, updated_at)
    VALUES (@user_id, @date, @steps, 'apple_health', datetime('now'))
    ON CONFLICT(user_id, date) DO UPDATE SET
      steps = excluded.steps,
      updated_at = excluded.updated_at
  `);

  const tx = db.transaction((batch: HealthKitStepsInput[]) => {
    for (const row of batch) {
      stmt.run({ user_id: userId, date: row.date, steps: row.steps });
      result.upserted += 1;
    }
  });

  const valid: HealthKitStepsInput[] = [];
  for (const row of rows) {
    const parsed = validate(row);
    if (parsed) valid.push(parsed);
    else result.skipped += 1;
  }

  if (valid.length > 0) tx(valid);
  return result;
}
