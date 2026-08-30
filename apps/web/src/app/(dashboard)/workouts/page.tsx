import { headers } from "next/headers";
import SportFrequencyChart from "@/components/charts/SportFrequencyChart";
import WorkoutZoneChart from "@/components/charts/WorkoutZoneChart";
import WorkoutDistanceChart from "@/components/charts/WorkoutDistanceChart";
import Zone2Tracker from "@/components/charts/Zone2Tracker";
import CardiacDriftCard from "@/components/charts/CardiacDriftCard";
import WorkoutsTable from "@/components/workouts/WorkoutsTable";
import { getWorkoutsRange, getWorkoutRowsRange, getBodyMeasurements } from "@/lib/db";
import { requireAuthOrSignin } from "@/lib/auth";
import { computeCardiacDrift } from "@/lib/analytics/cardiacDrift";
import { resolveRangeWindow } from "@/lib/range";
import { localToday } from "@/lib/date";

export const dynamic = "force-dynamic";

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
  const today = localToday();
  const window = resolveRangeWindow(range, today);
  const rangeResult = getWorkoutsRange(user.id, window.start, window.end);
  const rangeRows = getWorkoutRowsRange(user.id, window.start, window.end);
  const rangeLabel = window.label;
  const body = getBodyMeasurements(user.id);
  const maxHR = body?.max_heart_rate ?? null;
  const driftReport = computeCardiacDrift(rangeRows);

  return (
    <>
      <SportFrequencyChart rows={rangeRows} rangeLabel={rangeLabel} />

      <WorkoutZoneChart rows={rangeRows} maxHR={maxHR} rangeLabel={rangeLabel} />

      <CardiacDriftCard report={driftReport} rangeLabel={rangeLabel} />

      <div className="grid-main">
        <div className="col">
          <WorkoutDistanceChart rows={rangeRows} rangeLabel={rangeLabel} />
        </div>
        <div className="col">
          <Zone2Tracker rows={rangeRows} rangeLabel={rangeLabel} />
        </div>
      </div>

      <WorkoutsTable rows={rangeResult.rows} />
    </>
  );
}
