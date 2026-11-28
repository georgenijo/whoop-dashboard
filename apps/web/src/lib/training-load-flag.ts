/**
 * Server-side gate for the Training Load page (`/load`). Off unless
 * `TRAINING_LOAD=1`; read per call so tests (and a restart with a changed
 * env) see the current value. Flag off = route 404s before auth or any DB
 * read, and no nav entry renders.
 */
export function isTrainingLoadEnabled(): boolean {
  return process.env.TRAINING_LOAD === "1";
}
