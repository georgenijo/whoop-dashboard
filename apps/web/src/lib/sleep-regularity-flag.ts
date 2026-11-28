/**
 * Server-side gate for the Sleep regularity page (`/sleep/regularity`). Off
 * unless `SLEEP_REGULARITY=1`; read per call so tests (and a restart with a
 * changed env) see the current value. Flag off = route 404s before auth or
 * any DB read, and the Sleep page renders no link to it.
 */
export function isSleepRegularityEnabled(): boolean {
  return process.env.SLEEP_REGULARITY === "1";
}
