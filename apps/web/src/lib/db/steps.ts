import "server-only";
import { dateRangeClause, hasTable } from "./connection";
import { forUser } from "./scoped";

export type StepsSource = "whoop" | "apple_health" | "auto";

export type StepsRow = {
  /** Local display date. WHOOP rows cover a physiological cycle. */
  date: string;
  steps: number;
  source: "whoop" | "apple_health";
  updated_at: string;
  /** WHOOP-only metadata, optional for existing Apple Health consumers. */
  cycle_id?: number;
  cycle_start?: string;
  cycle_end?: string | null;
  score_state?: string | null;
  fetched_at?: string;
  is_partial?: boolean;
};

const APPLE_COLUMNS = "date, steps, source, updated_at";
const WHOOP_COLUMNS = `date, step_count AS steps, 'whoop' AS source,
  COALESCE(upstream_updated_at, fetched_at) AS updated_at,
  cycle_id, cycle_start, cycle_end, score_state, fetched_at`;

function withPartial(row: StepsRow): StepsRow {
  return { ...row, is_partial: row.cycle_end == null };
}

// A production DB may be read before openWrite() runs the additive schema
// migration. Keep GET paths read-only and treat that state as no native data.
function nativeTableAvailable(userId: number): boolean {
  return forUser(userId).read((db) => hasTable(db, "whoop_cycle_steps")) ?? false;
}

/** Choose one source for the user's entire history, including comparisons. */
export function resolveStepsSource(
  userId: number,
  source: StepsSource = "auto",
): "whoop" | "apple_health" {
  if (source !== "auto") return source;
  if (!nativeTableAvailable(userId)) return "apple_health";
  const hasNativeSteps = forUser(userId).get<{ present: number }>(
    "SELECT 1 AS present FROM whoop_cycle_steps WHERE step_count IS NOT NULL AND user_id = ? LIMIT 1",
  );
  return hasNativeSteps ? "whoop" : "apple_health";
}

export function getLatestSteps(userId: number, source: StepsSource = "auto"): StepsRow | null {
  const resolved = resolveStepsSource(userId, source);
  if (resolved === "whoop" && !nativeTableAvailable(userId)) return null;
  const row = resolved === "whoop"
    ? forUser(userId).get<StepsRow>(
      `SELECT ${WHOOP_COLUMNS} FROM whoop_cycle_steps
       WHERE step_count IS NOT NULL AND user_id = ?
       ORDER BY date DESC, cycle_start DESC, cycle_id DESC LIMIT 1`,
    )
    : forUser(userId).get<StepsRow>(
      `SELECT ${APPLE_COLUMNS} FROM daily_steps
       WHERE source = 'apple_health' AND user_id = ? ORDER BY date DESC LIMIT 1`,
    );
  return row ? (resolved === "whoop" ? withPartial(row) : row) : null;
}

export function getPreviousSteps(userId: number, source: StepsSource = "auto"): StepsRow | null {
  const resolved = resolveStepsSource(userId, source);
  if (resolved === "whoop" && !nativeTableAvailable(userId)) return null;
  const row = resolved === "whoop"
    ? forUser(userId).get<StepsRow>(
      `SELECT ${WHOOP_COLUMNS} FROM whoop_cycle_steps
       WHERE step_count IS NOT NULL AND user_id = ?
       ORDER BY date DESC, cycle_start DESC, cycle_id DESC LIMIT 1 OFFSET 1`,
    )
    : forUser(userId).get<StepsRow>(
      `SELECT ${APPLE_COLUMNS} FROM daily_steps
       WHERE source = 'apple_health' AND user_id = ? ORDER BY date DESC LIMIT 1 OFFSET 1`,
    );
  return row ? (resolved === "whoop" ? withPartial(row) : row) : null;
}

export function getStepsRange(
  userId: number,
  startDate: string,
  endDate: string,
  source: StepsSource = "auto",
): StepsRow[] {
  const range = dateRangeClause(startDate, endDate);
  const resolved = resolveStepsSource(userId, source);
  if (resolved === "whoop" && !nativeTableAvailable(userId)) return [];
  return resolved === "whoop"
    ? forUser(userId).all<StepsRow>(
      `SELECT ${WHOOP_COLUMNS} FROM whoop_cycle_steps
       WHERE ${range.clause} AND step_count IS NOT NULL AND user_id = ?
       ORDER BY date ASC, cycle_start ASC, cycle_id ASC`,
      ...range.params,
    ).map(withPartial)
    : forUser(userId).all<StepsRow>(
      `SELECT ${APPLE_COLUMNS} FROM daily_steps
       WHERE ${range.clause} AND source = 'apple_health' AND user_id = ? ORDER BY date ASC`,
      ...range.params,
    );
}

export function getStepsTrend(
  userId: number,
  startDate: string,
  endDate: string,
  source: StepsSource = "auto",
): StepsRow[] {
  return getStepsRange(userId, startDate, endDate, source);
}
