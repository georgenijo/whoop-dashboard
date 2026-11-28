/**
 * Server-side gate for the Workout calendar page (`/workouts/calendar`). Off
 * unless `WORKOUT_CALENDAR=1`; read per call so tests (and a restart with a
 * changed env) see the current value. Flag off = route 404s before auth or
 * any DB read, and the Workouts page renders no link to it.
 */
export function isWorkoutCalendarEnabled(): boolean {
  return process.env.WORKOUT_CALENDAR === "1";
}
