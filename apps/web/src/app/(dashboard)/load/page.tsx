import { headers } from "next/headers";
import { notFound } from "next/navigation";
import TrainingLoadView from "@/components/load/TrainingLoadView";
import {
  CHART_DAYS,
  CHRONIC_DAYS,
  buildLoadSummary,
  shiftDay,
} from "@/lib/analytics/trainingLoad";
import { requireAuthOrSignin } from "@/lib/auth";
import { getStrainRange, getUserSettings } from "@/lib/db";
import { isTrainingLoadEnabled } from "@/lib/training-load-flag";
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

export default async function TrainingLoadPage() {
  // Gate first: with TRAINING_LOAD unset this route does no auth or DB work.
  if (!isTrainingLoadEnabled()) notFound();

  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const today = userToday(getUserSettings(user.id)?.tz, new Date());
  // The oldest chart day needs a full 28-day chronic window behind it.
  const start = shiftDay(today, -(CHART_DAYS - 1) - (CHRONIC_DAYS - 1));
  const rows = getStrainRange(user.id, start, today);
  const summary = buildLoadSummary(
    rows.map((r) => ({ date: r.date, strain: r.strain })),
    today,
  );

  return <TrainingLoadView summary={summary} />;
}
