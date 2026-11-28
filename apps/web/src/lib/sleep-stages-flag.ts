/**
 * Server-side gate for the Sleep stages page (`/sleep/stages`). Off unless
 * `SLEEP_STAGES=1`; read per call so tests (and a restart with a changed env)
 * see the current value. Flag off = route 404s before auth or any DB read,
 * and the Sleep page renders no link to it.
 */
export function isSleepStagesEnabled(): boolean {
  return process.env.SLEEP_STAGES === "1";
}
