import { headers } from "next/headers";
import SportFrequencyChart from "@/components/charts/SportFrequencyChart";
import WorkoutZoneChart from "@/components/charts/WorkoutZoneChart";
import WorkoutDistanceChart from "@/components/charts/WorkoutDistanceChart";
import Zone2Tracker from "@/components/charts/Zone2Tracker";
import CardiacDriftCard from "@/components/charts/CardiacDriftCard";
import { getWorkouts, getWorkoutsRange, getBodyMeasurements } from "@/lib/db";
import { requireAuthOrSignin } from "@/lib/auth";
import { computeCardiacDrift } from "@/lib/analytics/cardiacDrift";
import ExpandableWorkoutRow from "./ExpandableWorkoutRow";

export const dynamic = "force-dynamic";

function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isoNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default async function WorkoutsPage() {
  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const workouts = getWorkouts(user.id, 50);
  const today = new Date().toISOString().slice(0, 10);
  const last90 = getWorkoutsRange(user.id, isoNDaysAgo(90), today).rows;
  const last180 = getWorkoutsRange(user.id, isoNDaysAgo(180), today).rows;
  const body = getBodyMeasurements(user.id);
  const maxHR = body?.max_heart_rate ?? null;
  const driftReport = computeCardiacDrift(last180);

  return (
    <>
      <SportFrequencyChart rows={last90} />

      <WorkoutZoneChart rows={last90} maxHR={maxHR} />

      <CardiacDriftCard report={driftReport} />

      <div className="grid-main">
        <div className="col">
          <WorkoutDistanceChart rows={last90} />
        </div>
        <div className="col">
          <Zone2Tracker rows={last90} />
        </div>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "#ffaa00", color: "#ffaa00" }} />
            Recent workouts
          </div>
          <span className="card-sub">{workouts.length} sessions</span>
        </div>
        {workouts.length === 0 ? (
          <div className="empty-state">
            <div className="title">No workouts yet</div>
            <div className="sub">Sync Whoop to see workout history</div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                {["Date", "Sport", "Duration", "Strain", "Avg HR", "Max HR", "kcal"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 10px", color: "var(--fg-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 10 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workouts.map((w) => (
                <ExpandableWorkoutRow
                  key={w.id}
                  workout={w}
                  formattedDate={formatDate(w.date)}
                  formattedDuration={formatDuration(w.duration_sec)}
                  kilojoule={w.kilojoule}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
