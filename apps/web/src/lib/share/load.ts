import "server-only";
import { getRecoveryRange, getSleepRange, getStrainRange, getWorkoutRowsRange } from "@/lib/db";
import { getInsightTimezone } from "@/lib/db/summary";
import { addDays, todayInTz } from "@/lib/analytics/dayDetail";
import { BASELINE_DAYS, buildTodayCard, type ShareOptions, type TodayCardModel } from "./todayCard";

/**
 * Read the signed-in user's rows for the snapshot card through the existing
 * tenant-scoped readers (no new SQL) and hand them to the pure model.
 * `userId` must come from `requireAuth` — never from the request.
 *
 * Windows: today + yesterday for sleep/strain/workouts (the model falls back
 * to yesterday when today has nothing yet), and BASELINE_DAYS before
 * yesterday for recovery so the HRV/RHR "usual" band has history either way.
 */
export function loadTodayCard(userId: number, opts: ShareOptions, now: Date = new Date()): TodayCardModel {
  const tz = getInsightTimezone(userId);
  const today = todayInTz(now, tz);
  const yesterday = addDays(today, -1);
  return buildTodayCard({
    today,
    tz,
    recovery: getRecoveryRange(userId, addDays(yesterday, -BASELINE_DAYS), today),
    sleep: getSleepRange(userId, yesterday, today),
    cycles: getStrainRange(userId, yesterday, today),
    workouts: getWorkoutRowsRange(userId, yesterday, today),
    ...opts,
  });
}
