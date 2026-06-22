import "server-only";
import { getRecoveryRange, type RecoveryRow } from "@/lib/db";
import { localToday, localDateNDaysAgo } from "@/lib/date";
import { recoveryBand, type Band } from "@/components/plans/band";

// ---------------------------------------------------------------------------
// Issue #421 — SINGLE SOURCE OF TRUTH for the Plans surface's recovery view.
//
// Both the /plans PAGE (apps/web/src/app/(dashboard)/plans/page.tsx) and the
// GET /api/plans route (apps/web/src/app/api/plans/route.ts) call
// `getPlansRecovery(userId)` so the page banner / readiness strip and the iOS
// Plans tab can never drift. Recovery reads stay user-scoped via
// getRecoveryRange(...) -> forUser(...).
// ---------------------------------------------------------------------------

/** Re-export the band type so API consumers don't reach into components/. */
export type { Band };

/** Raw recovery window the page + API both build on. `today` is the most recent
 *  scored day in the 7-day window (today's row when scored, else the latest
 *  scored day — mirrors the dashboard's fallback). `week` is the in-window rows
 *  keyed by date, ascending. */
export interface PlansRecoveryWindow {
  /** Inclusive window start, YYYY-MM-DD (today - 6 days). */
  weekStart: string;
  /** Today, YYYY-MM-DD (local server date). */
  today: string;
  /** All scored-or-not recovery rows in [weekStart, today], ascending by date. */
  rows: RecoveryRow[];
  /** The "today" banner row: today's row when scored, else latest scored. */
  bannerRow: RecoveryRow | null;
}

/** The most recent available recovery day, banded — null when no scored day in
 *  the window. Matches the /plans banner definition exactly. */
export interface PlansRecoveryToday {
  date: string;
  recovery_score: number;
  band: Band;
}

/** A single day in the 7-day readiness strip (real scores only, ascending). */
export interface PlansRecoveryWeekDay {
  date: string;
  recovery_score: number;
}

/** API-shaped recovery block surfaced on GET /api/plans (sibling of `plans`). */
export interface PlansRecovery {
  today: PlansRecoveryToday | null;
  week: PlansRecoveryWeekDay[];
}

/**
 * Compute the today + 7-day recovery window for a user. The single source the
 * /plans page and GET /api/plans both consume. User-scoped via getRecoveryRange.
 */
export function getPlansRecoveryWindow(userId: number): PlansRecoveryWindow {
  const today = localToday();
  const weekStart = localDateNDaysAgo(6); // inclusive 7-day window ending today
  const rows = getRecoveryRange(userId, weekStart, today); // ascending by date

  const todayRow = rows.find((r) => r.date === today);
  // Latest scored day in the window — rows are ascending, so scan from the end.
  const latestScored = [...rows]
    .reverse()
    .find((r) => r.recovery_score != null);
  const bannerRow =
    todayRow?.recovery_score != null ? todayRow : latestScored ?? null;

  return { weekStart, today, rows, bannerRow };
}

/**
 * The API-shaped recovery block: `today` (most recent scored day, banded) and
 * `week` (real scores in the last 7 days, ascending). Both nullable/sparse —
 * iOS decodes defensively; older clients ignore the block entirely.
 */
export function getPlansRecovery(userId: number): PlansRecovery {
  const { rows, bannerRow } = getPlansRecoveryWindow(userId);

  const today: PlansRecoveryToday | null =
    bannerRow?.recovery_score != null
      ? {
          date: bannerRow.date,
          recovery_score: bannerRow.recovery_score,
          band: recoveryBand(bannerRow.recovery_score),
        }
      : null;

  const week: PlansRecoveryWeekDay[] = rows
    .filter((r): r is RecoveryRow & { recovery_score: number } =>
      r.recovery_score != null,
    )
    .map((r) => ({ date: r.date, recovery_score: r.recovery_score }));

  return { today, week };
}
