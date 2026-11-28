import { headers } from "next/headers";
import { notFound } from "next/navigation";
import DayDetailView from "@/components/day/DayDetailView";
import { parseDayParam, todayInTz, validateDayParam } from "@/lib/analytics/dayDetail";
import { requireAuthOrSignin } from "@/lib/auth";
import { getUserSettings } from "@/lib/db";
import { loadDayDetail } from "@/lib/day-detail";
import { isDayDetailEnabled } from "@/lib/day-detail-flag";

export const dynamic = "force-dynamic";

export default async function DayDetailPage({
  params,
}: {
  // Next.js 16.2.4: dynamic route params are async (a Promise).
  params: Promise<{ date: string }>;
}) {
  // Gate first: with DAY_DETAIL unset this route does no auth or DB work.
  if (!isDayDetailEnabled()) notFound();

  const { date: raw } = await params;
  // Malformed / impossible dates 404 before auth too — no DB work for junk.
  if (!parseDayParam(raw)) notFound();

  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const tz = getUserSettings(user.id)?.tz ?? "UTC";
  const today = todayInTz(new Date(), tz);
  const checked = validateDayParam(raw, today);
  if (!checked.ok) notFound();

  return <DayDetailView day={loadDayDetail(user.id, checked.date, today, tz)} />;
}
