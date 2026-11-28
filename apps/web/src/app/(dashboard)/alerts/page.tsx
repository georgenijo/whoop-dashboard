import { headers } from "next/headers";
import { notFound } from "next/navigation";
import HealthAlertsView from "@/components/alerts/HealthAlertsView";
import { requireAuthOrSignin } from "@/lib/auth";
import { isHealthAlertsEnabled } from "@/lib/health-alerts-flag";
import { loadHealthAlerts } from "@/lib/health-alerts";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  // Gate first: with HEALTH_ALERTS off this route does no auth or DB work.
  if (!isHealthAlertsEnabled()) notFound();
  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  return <HealthAlertsView result={loadHealthAlerts(user.id)} />;
}
