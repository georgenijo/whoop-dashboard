import { headers } from "next/headers";
import { notFound } from "next/navigation";
import SleepRegularityView from "@/components/sleep/SleepRegularityView";
import { requireAuthOrSignin } from "@/lib/auth";
import { getSleepRange, getUserSettings } from "@/lib/db";
import {
  computeSleepRegularity,
  parseRegularityWindow,
  shiftDate,
} from "@/lib/analytics/sleepRegularity";
import { isSleepRegularityEnabled } from "@/lib/sleep-regularity-flag";
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

export default async function SleepRegularityPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  // Gate first: with SLEEP_REGULARITY unset this route does no auth or DB work.
  if (!isSleepRegularityEnabled()) notFound();

  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const windowDays = parseRegularityWindow((await searchParams).window);
  const today = userToday(getUserSettings(user.id)?.tz, new Date());
  // Non-nap, one-row-per-wake-day reader (SLEEP_DEDUP_WHERE), user-scoped.
  const rows = getSleepRange(user.id, shiftDate(today, -(windowDays - 1)), today);
  return <SleepRegularityView result={computeSleepRegularity(rows, today, windowDays)} />;
}
