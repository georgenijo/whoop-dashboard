import { headers } from "next/headers";
import KPIStrip from "@/components/overview/KPIStrip";
import TrendChart from "@/components/charts/TrendChart";
import TSBCurve from "@/components/charts/TSBCurve";
import TodayKpis from "@/components/strain/TodayKpis";
import TodayWorkouts from "@/components/strain/TodayWorkouts";
import FreshnessBanner from "@/components/strain/FreshnessBanner";
import {
  getOverviewSnapshot,
  getStrainRange,
  getTodayStrainAggregate,
  getTodayWorkouts,
} from "@/lib/db";
import { requireAuthOrSignin } from "@/lib/auth";
import { resolveRangeWindow, rowsInWindow, shiftDate } from "@/lib/range";
import { localToday } from "@/lib/date";

export const dynamic = "force-dynamic";

export default async function StrainPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const { range } = await searchParams;
  const today = localToday();
  const window = resolveRangeWindow(range, today);
  const { label: rangeLabel } = window;
  const data = getOverviewSnapshot(user.id);
  // The TSB curve needs ~180 days of history before the window. That wider
  // fetch also contains the window itself, so the strain range is queried once.
  const tsbStart = window.start === "0000-01-01"
    ? window.start
    : shiftDate(window.start, -180);
  const tsbTrend = getStrainRange(user.id, tsbStart, window.end);
  const trend = rowsInWindow(tsbTrend, window.start, window.end);

  const strainData = trend.map((r) => ({ date: r.date, value: r.strain }));
  const hrData = trend.map((r) => ({ date: r.date, value: r.avg_hr }));

  const todayAgg = getTodayStrainAggregate(user.id, today);
  const todayWorkouts = getTodayWorkouts(user.id, today);

  const latestStrainDate = trend.length > 0 ? trend[trend.length - 1].date : null;

  return (
    <>
      <FreshnessBanner latestDate={latestStrainDate} today={today} />
      <KPIStrip
        latestRecovery={data.latestRecovery}
        previousRecovery={data.previousRecovery}
        latestCycle={data.latestCycle}
        previousCycle={data.previousCycle}
        latestSleep={data.latestSleep}
        previousSleep={data.previousSleep}
        latestSteps={data.latestSteps}
        previousSteps={data.previousSteps}
      />

      <TodayKpis
        totalKilojoule={todayAgg.total_kilojoule}
        avgHr={todayAgg.avg_hr}
        maxHr={todayAgg.max_hr}
        workoutCount={todayAgg.workout_count}
      />

      <TodayWorkouts rows={todayWorkouts} />

      <div className="grid-main">
        <div className="col">
          <TrendChart
            title="Daily Strain"
            subtitle={rangeLabel}
            color="#ffaa00"
            gradientId="strain"
            data={strainData}
            unit=""
            showRollingToggle
          />
        </div>
        <div className="col">
          <TrendChart
            title="Average Heart Rate"
            subtitle={rangeLabel}
            color="#ff6b6b"
            gradientId="avg-hr"
            data={hrData}
            unit=" bpm"
            showRollingToggle
          />
        </div>
      </div>

      <TSBCurve rows={tsbTrend} displayStart={window.start} rangeLabel={rangeLabel} />
    </>
  );
}
