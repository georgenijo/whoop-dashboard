import "server-only";
import { cache } from "react";
import {
  getLastSuccessfulSyncAt,
  getRecoveryRange,
  getSleepRange,
  getStrainRange,
} from "@/lib/db";
import { getInsightToday } from "@/lib/db/summary";
import { shiftDate } from "@/lib/range";
import {
  HEALTH_ALERTS_LOOKBACK_DAYS,
  computeHealthAlerts,
  type HealthAlertsResult,
} from "@/lib/analytics/healthAlerts";

/**
 * Read the user's last ~60 days through the existing user-scoped readers and
 * evaluate the alert rules. `cache()` dedupes the layout's badge read and the
 * /alerts page's read within one request. Callers must check
 * `isHealthAlertsEnabled()` first — this function does not.
 */
export const loadHealthAlerts = cache((userId: number): HealthAlertsResult => {
  const today = getInsightToday(userId);
  const start = shiftDate(today, -HEALTH_ALERTS_LOOKBACK_DAYS);
  return computeHealthAlerts({
    today,
    nowMs: Date.now(),
    recovery: getRecoveryRange(userId, start, today),
    sleep: getSleepRange(userId, start, today),
    cycles: getStrainRange(userId, start, today),
    lastSyncAt: getLastSuccessfulSyncAt(userId),
  });
});
