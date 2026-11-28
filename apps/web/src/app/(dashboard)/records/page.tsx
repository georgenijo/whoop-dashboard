import { headers } from "next/headers";
import { notFound } from "next/navigation";
import RecordsView from "@/components/records/RecordsView";
import { buildRecordBoard } from "@/lib/analytics/records";
import { requireAuthOrSignin } from "@/lib/auth";
import { getPRStats, getRecordSeries, getUserSettings } from "@/lib/db";
import { isRecordsPageEnabled } from "@/lib/records-flag";
import { parseDate } from "@/lib/whoop/upsert";

export const dynamic = "force-dynamic";

export default async function RecordsPage() {
  // Gate first: with RECORDS_PAGE unset this route does no auth or DB work.
  if (!isRecordsPageEnabled()) notFound();

  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const tz = getUserSettings(user.id)?.tz ?? "UTC";
  const today = parseDate(new Date().toISOString(), tz);
  const board = buildRecordBoard(getRecordSeries(user.id), { today });
  const { recoveryStreak, sleepPerfStreak, loggingStreak } = getPRStats(user.id);

  return (
    <RecordsView
      board={board}
      streaks={{ recoveryStreak, sleepPerfStreak, loggingStreak }}
      today={today}
    />
  );
}
