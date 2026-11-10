import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";
import RecoveryHero from "@/components/overview/RecoveryHero";
import KPIStrip from "@/components/overview/KPIStrip";
import RecoveryTrend from "@/components/overview/RecoveryTrend";
import AIInsightCard from "@/components/overview/AIInsightCard";
import PRsCard from "@/components/overview/PRsCard";
import SetupCard from "@/components/overview/SetupCard";
import NeedsReconnectBanner from "@/components/overview/NeedsReconnectBanner";
import TzBackfill from "@/components/onboarding/TzBackfill";
import {
  getDailySummaryForDates,
  getOverviewSnapshot,
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
  const data = getOverviewSnapshot(user.id);
  const summaryByDate = new Map(
    getDailySummaryForDates(user.id, [
      ...(data.latestRecovery ? [data.latestRecovery.date] : []),
      ...(data.previousRecovery ? [data.previousRecovery.date] : []),
    ])
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
  return (
    <>
      <TzBackfill userId={user.id} />
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
        <Suspense key={`insight:${window.start}:${window.end}`} fallback={<InsightSkeleton />}>
          <InsightSection userId={user.id} hasInsightData={hasInsightData} />
        </Suspense>
      </div>

      <KPIStrip
        latestRecovery={latestRecovery}
        previousRecovery={previousRecovery}
        latestCycle={data.latestCycle}
        previousCycle={data.previousCycle}
        latestSleep={data.latestSleep}
        previousSleep={data.previousSleep}
        latestSteps={data.latestSteps}
        previousSteps={data.previousSteps}
      />

      <div className="grid-main">
        <div className="col">
          <Suspense key={`trend:${window.start}:${window.end}`} fallback={<TrendSkeleton />}>
            <TrendSection
              userId={user.id}
              start={window.start}
              end={window.end}
              rangeLabel={window.label}
            />
          </Suspense>
          <Suspense key={`prs:${window.start}:${window.end}`} fallback={<PRStatsSkeleton />}>
            <PRStatsSection userId={user.id} />
          </Suspense>
        </div>
        <div className="col">{/* Phase 2 */}</div>
      </div>
    </>
  );
}

async function InsightSection({
  userId,
  hasInsightData,
}: {
  userId: number;
  hasInsightData: boolean;
}) {
  await yieldToStream();
  let insightStatus = getInsightStatus(userId, hasInsightData);

  // Resolve BYOK before scheduling; missing credentials are persisted as a
  // visible failure by the same retry gate as provider failures.
  let insightApiKey: string | null = null;
  try {
    insightApiKey = resolveApiKeyForUser(userId).key;
  } catch {
    insightApiKey = null;
  }
  const insightLock = acquireInsightRegenerationLock(insightStatus, insightApiKey);
  insightStatus = getInsightStatus(userId, hasInsightData);
  const insightRefreshing = insightStatus.isRegenerating || insightLock !== null;

  if (insightLock !== null && insightApiKey !== null) {
    const keyForAfter = insightApiKey;
    after(() => regenerateInsight(userId, keyForAfter, insightLock));
  }

  return (
    <AIInsightCard
      hasData={hasInsightData}
      insight={insightStatus.insight}
      refreshing={insightRefreshing}
      errorClass={insightStatus.errorClass}
      today={insightStatus.today}
    />
  );
}

async function TrendSection({
  userId,
  start,
  end,
  rangeLabel,
}: {
  userId: number;
  start: string;
  end: string;
  rangeLabel: string;
}) {
  await yieldToStream();
  return <RecoveryTrend rows={getRecoveryRange(userId, start, end)} rangeLabel={rangeLabel} />;
}

async function PRStatsSection({ userId }: { userId: number }) {
  await yieldToStream();
  return <PRsCard stats={getPRStats(userId)} />;
}

// The SQLite driver is synchronous. Yield once before each slow section so
// React can flush the surrounding Suspense fallbacks, then perform the query
// in the following event-loop turn. Without this boundary, an `async`
// component with only synchronous work would still block the entire stream.
function yieldToStream(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function InsightSkeleton() {
  return (
    <div className="ai-card animate-pulse" aria-label="Loading AI insight" aria-busy="true">
      <div className="ai-head">
        <span className="ai-tag">Coach</span>
        <span className="ai-when">Loading…</span>
      </div>
      <div className="h-3 w-4/5 rounded bg-white/10" />
      <div className="mt-3 h-3 w-3/5 rounded bg-white/10" />
    </div>
  );
}

function TrendSkeleton() {
  return (
    <div className="card animate-pulse" aria-label="Loading recovery trend" aria-busy="true">
      <div className="card-head">
        <div>
          <div className="h-4 w-28 rounded bg-white/10" />
          <div className="mt-2 h-3 w-36 rounded bg-white/10" />
        </div>
      </div>
      <div className="chart-body rounded bg-white/[0.03]" />
    </div>
  );
}

function PRStatsSkeleton() {
  return (
    <section className="overview-detail animate-pulse" aria-label="Loading personal records" aria-busy="true">
      <span className="overview-kicker">Detail</span>
      <details className="overview-disclosure">
        <summary>
          <span>Personal records</span>
          <span className="overview-disclosure-meta">Loading…</span>
          <span className="overview-disclosure-chevron" aria-hidden />
        </summary>
      </details>
    </section>
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
