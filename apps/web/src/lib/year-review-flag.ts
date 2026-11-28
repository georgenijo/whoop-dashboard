/**
 * Server-side gate for the Year in Review page (`/year`) and its Stats-page
 * link. Off unless `YEAR_REVIEW=1` is set in the server environment. Read per
 * request, never inlined into a client bundle.
 */
export function yearReviewEnabled(): boolean {
  return process.env.YEAR_REVIEW === "1";
}
