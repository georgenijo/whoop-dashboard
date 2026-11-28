import { headers } from "next/headers";
import { notFound } from "next/navigation";
import WorkoutCalendarView from "@/components/workouts/WorkoutCalendarView";
import { requireAuthOrSignin } from "@/lib/auth";
import { getUserSettings, getWorkoutRowsRange } from "@/lib/db";
import {
  buildWorkoutCalendar,
  monthQueryBounds,
  parseCalendarMonth,
} from "@/lib/analytics/workoutCalendar";
import { isWorkoutCalendarEnabled } from "@/lib/workout-calendar-flag";
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

export default async function WorkoutCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  // Gate first: with WORKOUT_CALENDAR unset this route does no auth or DB work.
  if (!isWorkoutCalendarEnabled()) notFound();

  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const tz = getUserSettings(user.id)?.tz;
  const today = userToday(tz, new Date());
  const month = parseCalendarMonth((await searchParams).month, today);
  // One bounded, user-scoped read: the month's 6-week-max grid ± 1 day.
  const { start, end } = monthQueryBounds(month);
  const rows = getWorkoutRowsRange(user.id, start, end);
  return <WorkoutCalendarView cal={buildWorkoutCalendar(rows, month, today, tz)} />;
}
