/**
 * Server-side gate for the shareable daily snapshot card (`/share/today` and
 * its PNG download at `/api/share/today`). Off unless `SHARE_CARD=1`; read
 * per call so tests (and a restart with a changed env) see the current
 * value. Flag off = both routes 404 before auth or any DB read, and no nav
 * entry renders.
 */
export function isShareCardEnabled(): boolean {
  return process.env.SHARE_CARD === "1";
}
