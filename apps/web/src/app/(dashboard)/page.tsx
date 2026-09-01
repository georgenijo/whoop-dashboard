import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import RecoveryHero from "@/components/overview/RecoveryHero";
import KPIStrip from "@/components/overview/KPIStrip";
import RecoveryTrend from "@/components/overview/RecoveryTrend";
import AIInsightCard from "@/components/overview/AIInsightCard";
import AIInsightRefreshWatcher from "@/components/overview/AIInsightRefreshWatcher";
import PRsCard from "@/components/overview/PRsCard";
import SetupCard from "@/components/overview/SetupCard";
import NeedsReconnectBanner from "@/components/overview/NeedsReconnectBanner";
import TzBackfill from "@/components/onboarding/TzBackfill";
import {
  getDailySummary,
  getOverview,
  getPRStats,
  getRecoveryRange,
  getUserSettings,
  type DailySummaryRow,
  type RecoveryRow,
} from "@/lib/db";
import { getIntegrationStatus } from "@/lib/db/integrations";
import { requireAuthOrSignin } from "@/lib/auth";
import { resolveApiKeyForUser } from "@/lib/coach/api-key";
import {
  acquireInsightRegenerationLock,
  getInsightStatus,
  regenerateInsight,
} from "@/lib/insights";
import { resolveRangeWindow } from "@/lib/range";
import { localToday } from "@/lib/date";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );

  // First-time visitors land on /welcome. `onboarded_at` is the set-once
  // stamp; anything other than a non-null value sends the user through the
  // wizard. redirect() throws NEXT_REDIRECT — must live outside any try/catch.
  const userSettings = getUserSettings(user.id);
  if (userSettings === null || userSettings.onboarded_at === null) {
    redirect("/welcome");
  }

  // Three-state partition for the overview-page Whoop nudge banners:
  //   - no integration row → SetupCard (finish onboarding)
  //   - row exists + needs_reauth → NeedsReconnectBanner (token rejected)
  //   - otherwise → no banner
  // Resolved once here; rendered at one site below.
  const whoopStatus = getIntegrationStatus(user.id, "whoop");

  const { range } = await searchParams;
  const window = resolveRangeWindow(range, localToday());
  const data = getOverview(user.id, window.days);
  const trend = getRecoveryRange(user.id, window.start, window.end);
  const prStats = getPRStats(user.id);
  const summaryByDate = new Map(
    getDailySummary(user.id, "0000-01-01", "9999-12-31")
      .filter((r) => r.recovery_score != null)
      .map((r) => [r.date, r] as const)
  );
  const latestRecovery = recoveryFromSummary(
    data.latestRecovery ? summaryByDate.get(data.latestRecovery.date) : undefined,
    data.latestRecovery
  );
  const previousRecovery = recoveryFromSummary(
    data.previousRecovery ? summaryByDate.get(data.previousRecovery.date) : undefined,
    data.previousRecovery
  );
  const hasInsightData =
    data.latestRecovery !== null || data.latestCycle !== null || data.latestSleep !== null;
  const insightStatus = getInsightStatus(user.id, hasInsightData);

  // BYOK-aware regen. If neither personal nor env key exists, skip
  // regeneration silently — the rest of the overview still renders. The
  // resolver throws MissingApiKeyError when both sources are empty; catch
  // and treat as "no key", same shape acquireInsightRegenerationLock expects.
  let insightApiKey: string | null = null;
  try {
    insightApiKey = resolveApiKeyForUser(user.id).key;
  } catch {
    insightApiKey = null;
  }
  const insightLock = acquireInsightRegenerationLock(insightStatus, insightApiKey);
  const insightRefreshing = insightStatus.isRegenerating || insightLock !== null;

  if (insightLock !== null && insightApiKey !== null) {
    const keyForAfter = insightApiKey;
    after(() => regenerateInsight(user.id, keyForAfter, insightLock));
  }

  return (
    <>
      <TzBackfill />
      {!whoopStatus.exists ? (
        <SetupCard />
      ) : whoopStatus.needs_reauth ? (
        <NeedsReconnectBanner />
      ) : null}
      <div className="hero">
        <RecoveryHero
          score={latestRecovery?.recovery_score ?? null}
          hrv={latestRecovery?.hrv ?? null}
          rhr={latestRecovery?.rhr ?? null}
          updatedAt={latestRecovery?.date ?? null}
        />
        <AIInsightCard
          hasData={hasInsightData}
          insight={insightStatus.insight}
          refreshing={insightRefreshing}
        />
      </div>
      {insightStatus.isStale && insightRefreshing ? <AIInsightRefreshWatcher /> : null}

      <KPIStrip
        latestRecovery={latestRecovery}
        previousRecovery={previousRecovery}
        latestCycle={data.latestCycle}
        previousCycle={data.previousCycle}
        latestSleep={data.latestSleep}
        previousSleep={data.previousSleep}
        latestSteps={data.latestSteps}
        previousSteps={data.previousSteps}
        recoveryTrend={data.recoveryTrend}
        strainTrend={data.strainTrend}
        sleepTrend={data.sleepTrend}
      />

      <div className="grid-main">
        <div className="col">
          <RecoveryTrend rows={trend} rangeLabel={window.label} />
          <PRsCard stats={prStats} />
        </div>
        <div className="col">{/* Phase 2 */}</div>
      </div>
    </>
  );
}

function recoveryFromSummary(
  row: DailySummaryRow | undefined,
  fallback: RecoveryRow | null
): RecoveryRow | null {
  if (!row) return fallback;
  const sameDate = fallback?.date === row.date;
  return {
    date: row.date,
    recovery_score: row.recovery_score,
    hrv: row.hrv_ms,
    rhr: row.resting_hr,
    spo2: sameDate ? fallback.spo2 : null,
    skin_temp: sameDate ? fallback.skin_temp : null,
  };
}
