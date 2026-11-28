import { headers } from "next/headers";
import { notFound } from "next/navigation";
import GoalsView from "@/components/goals/GoalsView";
import { DEFAULT_WEEK_START, goalsWindowStart, type GoalDayRow } from "@/lib/analytics/goals";
import { requireAuthOrSignin } from "@/lib/auth";
import { getDailySummary, getUserSettings } from "@/lib/db";
import { isGoalsPageEnabled } from "@/lib/goals-flag";
import { parseDate } from "@/lib/whoop/upsert";

export const dynamic = "force-dynamic";

/** Today's calendar date in the user's zone; falls back to UTC on a bad tz. */
function userToday(tz: string | null | undefined, now: Date): string {
  try {
    return parseDate(now.toISOString(), tz || "UTC");
  } catch {
    return parseDate(now.toISOString(), "UTC");
  }
}

export default async function GoalsPage() {
  // Gate first: with GOALS_PAGE unset this route does no auth or DB work.
  if (!isGoalsPageEnabled()) notFound();

  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const today = userToday(getUserSettings(user.id)?.tz, new Date());
  // One bounded, user-scoped read; only the fields the goals use go to the client.
  const rows: GoalDayRow[] = getDailySummary(user.id, goalsWindowStart(today), today).map((r) => ({
    date: r.date,
    recovery_score: r.recovery_score,
    resting_hr: r.resting_hr,
    sleep_hours: r.sleep_hours,
    sleep_performance: r.sleep_performance,
    day_strain: r.day_strain,
    workouts_count: r.workouts_count,
  }));
  // No week-start setting exists yet, so weeks start on Monday.
  return <GoalsView rows={rows} today={today} weekStart={DEFAULT_WEEK_START} />;
}
