import { headers } from "next/headers";
import { notFound } from "next/navigation";
import ShareTodayView from "@/components/share/ShareTodayView";
import { requireAuthOrSignin } from "@/lib/auth";
import { isShareCardEnabled } from "@/lib/share-card-flag";
import { loadTodayCard } from "@/lib/share/load";
import { parseShareOptions } from "@/lib/share/todayCard";

export const dynamic = "force-dynamic";

export default async function ShareTodayPage({
  searchParams,
}: {
  // Next.js 16.2.4: searchParams is async (a Promise).
  searchParams: Promise<{ hide?: string | string[]; theme?: string | string[] }>;
}) {
  // Gate first: with SHARE_CARD unset this route does no auth or DB work.
  if (!isShareCardEnabled()) notFound();

  const headerList = await headers();
  const { user } = await requireAuthOrSignin(new Request("http://localhost", { headers: headerList }));
  const opts = parseShareOptions(await searchParams);
  return <ShareTodayView model={loadTodayCard(user.id, opts)} />;
}
