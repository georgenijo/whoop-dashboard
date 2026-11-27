import "server-only";
import { getLatestRecovery, getLatestSleep, getTodayWorkouts } from "@/lib/db";
import { getInsightToday } from "@/lib/db/summary";
import type { CoachSuggestionContext } from "./suggestions";

/**
 * What the user has today, for the Coach empty-state prompts. Three indexed
 * single-row reads, all tenant-scoped through `forUser`. Only SCORED records
 * reach these tables, and sleep is dated by its wake day, so "last night's
 * sleep is scored" means the newest sleep row is dated today (user timezone).
 */
export function getCoachSuggestionContext(userId: number): CoachSuggestionContext {
  const today = getInsightToday(userId);
  const sleep = getLatestSleep(userId);
  const recovery = getLatestRecovery(userId);
  return {
    sleepScored: sleep?.date === today,
    recoveryScored: recovery?.date === today && recovery.recovery_score != null,
    workoutsToday: getTodayWorkouts(userId, today).length,
    hasHistory: sleep != null || recovery != null,
  };
}
