import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { todayInTz, validateDayParam } from "@/lib/analytics/dayDetail";
import { requireAuthOrSignin } from "@/lib/auth";
import { getUserSettings } from "@/lib/db";
import { isDayDetailEnabled } from "@/lib/day-detail-flag";

export const dynamic = "force-dynamic";

/**
 * `/day` and `/day?date=YYYY-MM-DD` — target of the Day detail page's
 * no-JS date picker form. Redirects to `/day/<date>`, or to today when the
 * date is missing, malformed or in the future.
 */
export default async function DayIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  if (!isDayDetailEnabled()) notFound();

  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const { date } = await searchParams;
  const tz = getUserSettings(user.id)?.tz ?? "UTC";
  const today = todayInTz(new Date(), tz);
  const checked = validateDayParam(Array.isArray(date) ? date[0] : date, today);
  redirect(`/day/${checked.ok ? checked.date : today}`);
}
