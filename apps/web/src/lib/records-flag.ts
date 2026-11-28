/**
 * Server-side gate for the Personal Records page (`/records`). Off unless
 * `RECORDS_PAGE=1`; read per call so tests (and a restart with a changed
 * env) see the current value. Flag off = route 404s before auth or any DB
 * read, and no nav entry renders.
 */
export function isRecordsPageEnabled(): boolean {
  return process.env.RECORDS_PAGE === "1";
}
