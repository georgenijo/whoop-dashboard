import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireAuthOrSignin } from "@/lib/auth";
import {
  getRecoveryRange,
  getSleepRange,
  getStrainRange,
  getWorkoutRowsRange,
} from "@/lib/db";
import { computeWeeklyReview, weekWindows } from "@/lib/analytics/weekly";
import { localToday } from "@/lib/date";
import { isWeeklyReviewEnabled } from "@/lib/weekly-flag";
import WeeklyReviewView from "@/components/weekly/WeeklyReviewView";
import "@/styles/weekly.css";

export const dynamic = "force-dynamic";

export default async function WeeklyPage() {
  // Gate first: with the flag off this route does no auth or DB work at all.
  if (!isWeeklyReviewEnabled()) notFound();

  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );

  const today = localToday();
  const { current, previous } = weekWindows(today);
  const start = previous.start;
  const end = current.end;

  const review = computeWeeklyReview({
    today,
    recovery: getRecoveryRange(user.id, start, end),
    sleep: getSleepRange(user.id, start, end),
    cycles: getStrainRange(user.id, start, end),
    workouts: getWorkoutRowsRange(user.id, start, end),
  });

  return <WeeklyReviewView review={review} />;
}
