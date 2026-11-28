import { headers } from "next/headers";
import { notFound } from "next/navigation";
import SleepStagesView from "@/components/sleep/SleepStagesView";
import { requireAuthOrSignin } from "@/lib/auth";
import { getSleepRange, getUserSettings } from "@/lib/db";
import {
  HISTORY_DAYS,
  computeSleepStages,
  parseStagesWindow,
  shiftDate,
} from "@/lib/analytics/sleepStages";
import { isSleepStagesEnabled } from "@/lib/sleep-stages-flag";
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

export default async function SleepStagesPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  // Gate first: with SLEEP_STAGES unset this route does no auth or DB work.
  if (!isSleepStagesEnabled()) notFound();

  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const windowDays = parseStagesWindow((await searchParams).days);
  const today = userToday(getUserSettings(user.id)?.tz, new Date());
  // One read covers the window, the 30-vs-30 trend and the personal range.
  // Non-nap, one row per wake day (SLEEP_DEDUP_WHERE), user-scoped.
  const rows = getSleepRange(user.id, shiftDate(today, -(HISTORY_DAYS - 1)), today);
  return <SleepStagesView result={computeSleepStages(rows, today, windowDays)} />;
}
