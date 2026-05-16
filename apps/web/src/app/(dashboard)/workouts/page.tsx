import { headers } from "next/headers";
import SportFrequencyChart from "@/components/charts/SportFrequencyChart";
import WorkoutZoneChart from "@/components/charts/WorkoutZoneChart";
import WorkoutDistanceChart from "@/components/charts/WorkoutDistanceChart";
import Zone2Tracker from "@/components/charts/Zone2Tracker";
import CardiacDriftCard from "@/components/charts/CardiacDriftCard";
import WorkoutsTable from "@/components/workouts/WorkoutsTable";
import { getWorkoutsRange, getBodyMeasurements } from "@/lib/db";
import { requireAuthOrSignin } from "@/lib/auth";
import { computeCardiacDrift } from "@/lib/analytics/cardiacDrift";
import { parseDays, formatRangeLabel } from "@/lib/range";
import { localToday, localDateNDaysAgo } from "@/lib/date";

export const dynamic = "force-dynamic";

// CardiacDrift baseline needs a long window regardless of the page selector.
const CARDIAC_DRIFT_LOOKBACK_DAYS = 180;

export default async function WorkoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const { range } = await searchParams;
  const days = parseDays(range);
  const rangeLabel = formatRangeLabel(range);

  const today = localToday();
  const rangeRows = getWorkoutsRange(user.id, localDateNDaysAgo(days), today).rows;

  // CardiacDrift baseline is analytics-only; always use a long fixed window.
  const driftRows =
    days >= CARDIAC_DRIFT_LOOKBACK_DAYS
      ? rangeRows
      : getWorkoutsRange(user.id, localDateNDaysAgo(CARDIAC_DRIFT_LOOKBACK_DAYS), today).rows;
  const body = getBodyMeasurements(user.id);
  const maxHR = body?.max_heart_rate ?? null;
  const driftReport = computeCardiacDrift(driftRows);

  return (
    <>
      <SportFrequencyChart rows={rangeRows} rangeLabel={rangeLabel} />

      <WorkoutZoneChart rows={rangeRows} maxHR={maxHR} rangeLabel={rangeLabel} />

      <CardiacDriftCard report={driftReport} />

      <div className="grid-main">
        <div className="col">
          <WorkoutDistanceChart rows={rangeRows} />
        </div>
        <div className="col">
          <Zone2Tracker rows={rangeRows} />
        </div>
      </div>

      <WorkoutsTable rows={rangeRows} />
    </>
  );
}
