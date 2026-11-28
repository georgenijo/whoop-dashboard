/**
 * Server-side gate for the Data health page (`/data-health`). Off unless
 * `DATA_HEALTH=1`; read per call so tests (and a restart with a changed env)
 * see the current value. Flag off = route 404s before auth or any DB read,
 * and no nav entry renders.
 */
export function isDataHealthEnabled(): boolean {
  return process.env.DATA_HEALTH === "1";
}
