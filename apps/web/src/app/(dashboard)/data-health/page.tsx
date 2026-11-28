import { headers } from "next/headers";
import { notFound } from "next/navigation";
import DataHealthView from "@/components/data-health/DataHealthView";
import {
  DATA_HEALTH_FETCH_DAYS,
  buildDataHealth,
  parseWindow,
  shiftIsoDate,
} from "@/lib/analytics/dataHealth";
import { isRecoveryDriversEnabled } from "@/lib/analytics/recoveryDrivers";
import { isSleepPlanEnabled } from "@/lib/analytics/sleepPlan";
import { requireAuthOrSignin } from "@/lib/auth";
import { isDataHealthEnabled } from "@/lib/data-health-flag";
import {
  getNaps,
  getRecoveryRange,
  getSleepRangeRaw,
  getStrainRange,
  getSyncLogs,
  getUserSettings,
  getWorkoutRowsRange,
} from "@/lib/db";
import { isTrainingLoadEnabled } from "@/lib/training-load-flag";
import { isWeeklyReviewEnabled } from "@/lib/weekly-flag";
import { parseDate } from "@/lib/whoop/upsert";

export const dynamic = "force-dynamic";

/** Valid IANA zone or UTC. */
function resolveTz(tz: string | null | undefined, now: Date): string {
  if (!tz) return "UTC";
  try {
    parseDate(now.toISOString(), tz);
    return tz;
  } catch {
    return "UTC";
  }
}

export default async function DataHealthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Gate first: with DATA_HEALTH unset this route does no auth or DB work.
  if (!isDataHealthEnabled()) notFound();

  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const window = parseWindow((await searchParams)?.window);
  const now = new Date();
  const tz = resolveTz(getUserSettings(user.id)?.tz, now);
  const today = parseDate(now.toISOString(), tz);
  const start = shiftIsoDate(today, -(DATA_HEALTH_FETCH_DAYS - 1));

  // Every read is scoped to this user through `forUser` / `WHERE user_id = ?`.
  const summary = buildDataHealth({
    today,
    window,
    recovery: getRecoveryRange(user.id, start, today),
    sleeps: getSleepRangeRaw(user.id, start, today),
    naps: getNaps(user.id, start, today),
    cycles: getStrainRange(user.id, start, today),
    workouts: getWorkoutRowsRange(user.id, start, today),
    syncLogs: getSyncLogs(user.id),
    features: {
      trainingLoad: isTrainingLoadEnabled(),
      sleepPlan: isSleepPlanEnabled(),
      recoveryDrivers: isRecoveryDriversEnabled(),
      weeklyReview: isWeeklyReviewEnabled(),
    },
  });

  return <DataHealthView summary={summary} tz={tz} />;
}
