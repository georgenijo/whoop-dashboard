import Link from "next/link";
import { headers } from "next/headers";
import SportFrequencyChart from "@/components/charts/SportFrequencyChart";
import WorkoutZoneChart from "@/components/charts/WorkoutZoneChart";
import WorkoutDistanceChart from "@/components/charts/WorkoutDistanceChart";
import Zone2Tracker from "@/components/charts/Zone2Tracker";
import CardiacDriftCard from "@/components/charts/CardiacDriftCard";
import WorkoutsTable from "@/components/workouts/WorkoutsTable";
import { capWorkoutRows, getWorkoutRowsRange, getBodyMeasurements } from "@/lib/db";
import { requireAuthOrSignin } from "@/lib/auth";
import { computeCardiacDrift } from "@/lib/analytics/cardiacDrift";
import { resolveRangeWindow } from "@/lib/range";
import { localToday } from "@/lib/date";
import { computeVsUsualChips } from "@/lib/analytics/similarWorkouts";
import { isSimilarWorkoutsEnabled } from "@/lib/similar-workouts-flag";
import { isWorkoutCalendarEnabled } from "@/lib/workout-calendar-flag";

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
  // One uncapped query; the table's capped view is derived from it.
  const rangeRows = getWorkoutRowsRange(user.id, window.start, window.end);
  const rangeResult = capWorkoutRows(rangeRows);
  const rangeLabel = window.label;
  const body = getBodyMeasurements(user.id);
  const maxHR = body?.max_heart_rate ?? null;
  const driftReport = computeCardiacDrift(rangeRows);
  // SIMILAR_WORKOUTS=1: "vs usual" chips from the rows already loaded above —
  // no extra query. Comparisons only see sessions inside the selected range.
  const vsUsual = isSimilarWorkoutsEnabled() ? computeVsUsualChips(rangeRows) : undefined;

  return (
    <>
      {isWorkoutCalendarEnabled() && (
        <Link
          href="/workouts/calendar"
          className="card"
          data-testid="workout-calendar-link"
          style={{ display: "block", marginBottom: 24, textDecoration: "none", color: "inherit" }}
        >
          <div className="card-title">
            <span className="dot" style={{ background: "#ffaa00", color: "#ffaa00" }} />
            Workout calendar →
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            Month view of every session, training streaks and rest days
          </div>
        </Link>
      )}
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

      <WorkoutsTable rows={rangeResult.rows} vsUsual={vsUsual} />
    </>
  );
}
