/**
 * Server-side gate for the Your baselines page (`/baselines`). Off unless
 * `BASELINES_PAGE=1`; read per call so tests (and a restart with a changed
 * env) see the current value. Flag off = route 404s before auth or any DB
 * read, and no nav entry is rendered.
 */
export function isBaselinesPageEnabled(): boolean {
  return process.env.BASELINES_PAGE === "1";
}
