/**
 * Health Alerts center (`/alerts`, Sidebar entry + badge). Off unless the
 * server env has exactly `HEALTH_ALERTS=1`; read per request so toggling it
 * needs only a restart. With it off nothing new is reachable or rendered and
 * no extra DB reads happen.
 */
export function isHealthAlertsEnabled(): boolean {
  return process.env.HEALTH_ALERTS === "1";
}
