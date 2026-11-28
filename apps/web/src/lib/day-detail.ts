import "server-only";
import {
  getDailySummary,
  getJournalRange,
  getNaps,
  getRecoveryRange,
  getSleepRange,
  getStrainRange,
  getWorkoutRowsRange,
} from "@/lib/db";
import { buildDayDetail, type DayDetail } from "@/lib/analytics/dayDetail";

/**
 * Gather one day's rows for `userId` through the existing tenant-scoped
 * readers (no new SQL) and hand them to the pure model. `getSleepRange`
 * returns the deduped main sleep filed on its wake day, so "sleep" here is
 * the night that ended on `date` — the same night that produced its
 * recovery.
 */
export function loadDayDetail(userId: number, date: string, today: string, tz: string): DayDetail {
  return buildDayDetail({
    date,
    today,
    tz,
    recovery: getRecoveryRange(userId, date, date)[0] ?? null,
    sleep: getSleepRange(userId, date, date)[0] ?? null,
    naps: getNaps(userId, date, date),
    cycle: getStrainRange(userId, date, date)[0] ?? null,
    workouts: getWorkoutRowsRange(userId, date, date),
    journal: getJournalRange(userId, date, date),
    // daily_summary is recomputed for every date a sync writes, so its dates
    // are the user's days with data.
    datesWithData: getDailySummary(userId, "0000-01-01", today).map((r) => r.date),
  });
}
