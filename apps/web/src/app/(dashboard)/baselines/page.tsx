import { headers } from "next/headers";
import { notFound } from "next/navigation";
import BaselinesView from "@/components/baselines/BaselinesView";
import { requireAuthOrSignin } from "@/lib/auth";
import { getRecoveryRange, getSleepRange, getStrainRange, getUserSettings } from "@/lib/db";
import {
  baselineReadStart,
  computeBaselines,
  parseBaselineWindow,
} from "@/lib/analytics/baselines";
import { isBaselinesPageEnabled } from "@/lib/baselines-flag";
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

export default async function BaselinesPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  // Gate first: with BASELINES_PAGE unset this route does no auth or DB work.
  if (!isBaselinesPageEnabled()) notFound();

  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const windowDays = parseBaselineWindow((await searchParams).window);
  const today = userToday(getUserSettings(user.id)?.tz, new Date());
  const start = baselineReadStart(today, windowDays);
  // Three user-scoped range reads (forUser wrappers); sleep is non-nap,
  // one row per wake day (SLEEP_DEDUP_WHERE).
  const result = computeBaselines(
    {
      recovery: getRecoveryRange(user.id, start, today),
      sleep: getSleepRange(user.id, start, today),
      cycles: getStrainRange(user.id, start, today),
    },
    today,
    windowDays,
  );
  return <BaselinesView result={result} />;
}
