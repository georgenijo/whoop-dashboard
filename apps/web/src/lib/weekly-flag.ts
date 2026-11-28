/**
 * Server-side gate for the Weekly Review page (`/weekly`). Off unless the
 * process env sets `WEEKLY_REVIEW=1` exactly. Read per call (not at module
 * load) so tests and a service restart with a changed env both take effect.
 *
 * Flag off: `/weekly` 404s before any DB read and no nav entry renders.
 */
export function isWeeklyReviewEnabled(): boolean {
  return process.env.WEEKLY_REVIEW === "1";
}
