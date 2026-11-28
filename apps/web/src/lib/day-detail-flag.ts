/**
 * Server-side gate for the Day detail page (`/day/[date]`). Off unless
 * `DAY_DETAIL=1`; read per call so tests (and a restart with a changed env)
 * see the current value. Flag off = the route 404s before auth or any DB
 * read, and no link to it renders anywhere.
 */
export function isDayDetailEnabled(): boolean {
  return process.env.DAY_DETAIL === "1";
}
