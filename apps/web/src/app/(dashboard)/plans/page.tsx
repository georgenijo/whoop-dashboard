import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  getUserSettings,
  getWorkoutPlans,
  type RecoveryRow,
} from "@/lib/db";
import { requireAuthOrSignin } from "@/lib/auth";
import { localDateNDaysAgo } from "@/lib/date";
import { getPlansRecoveryWindow } from "@/lib/plans/recovery";
import TodayRecoveryBanner from "@/components/plans/TodayRecoveryBanner";
import ReadinessStrip, { type ReadinessDay } from "@/components/plans/ReadinessStrip";
import PlanCard from "@/components/plans/PlanCard";
import PlanDetail from "@/components/plans/PlanDetail";
import PlansEmptyState from "@/components/plans/PlansEmptyState";

export const dynamic = "force-dynamic";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function PlansPage() {
  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );

  // Onboarding gate — same contract as the overview page. redirect() throws
  // NEXT_REDIRECT; keep it out of any try/catch.
  const userSettings = getUserSettings(user.id);
  if (userSettings === null || userSettings.onboarded_at === null) {
    redirect("/welcome");
  }

  // Shared today + 7-day recovery window (single source of truth — the same
  // helper backs GET /api/plans so the page and the iOS Plans tab can't drift).
  const { today, rows: recovery, bannerRow } = getPlansRecoveryWindow(user.id);
  const byDate = new Map<string, RecoveryRow>();
  for (const r of recovery) byDate.set(r.date, r);

  const bannerScore = bannerRow?.recovery_score ?? null;
  const bannerDate = bannerRow?.date ?? null;

  // 7-day readiness strip, oldest -> newest, labelled by weekday.
  const days: ReadinessDay[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = localDateNDaysAgo(i);
    const row = byDate.get(date);
    days.push({
      date,
      label: WEEKDAY_LABELS[new Date(`${date}T00:00:00`).getDay()],
      score: row?.recovery_score ?? null,
      isToday: date === today,
    });
  }

  const plans = getWorkoutPlans(user.id);
  // The active plan (or the most recently updated) gets the expanded detail.
  const featured = plans.find((p) => p.is_active) ?? plans[0] ?? null;
  const otherPlans = plans.filter((p) => p.id !== featured?.id);

  return (
    <>
      <TodayRecoveryBanner
        score={bannerScore}
        dataDate={bannerDate}
        isToday={bannerDate === today}
      />

      <ReadinessStrip days={days} />

      {plans.length === 0 ? (
        <PlansEmptyState />
      ) : (
        <>
          {featured && <PlanDetail plan={featured} />}
          {otherPlans.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 18,
              }}
            >
              {otherPlans.map((p) => (
                <PlanCard key={p.id} plan={p} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
