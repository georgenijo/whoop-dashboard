/**
 * Server-side gate for the Personal Goals page (`/goals`). Off unless
 * `GOALS_PAGE=1`; read per call so tests (and a restart with a changed env)
 * see the current value. Flag off = route 404s before auth or any DB read,
 * and no nav entry renders.
 */
export function isGoalsPageEnabled(): boolean {
  return process.env.GOALS_PAGE === "1";
}
