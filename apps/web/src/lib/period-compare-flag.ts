/**
 * Server-side gate for the /compare page and its nav entry. Off unless the
 * process env sets PERIOD_COMPARE=1 exactly. Read per call so tests can flip
 * it; there is no client-visible copy of this flag.
 */
export function isPeriodCompareEnabled(): boolean {
  return process.env.PERIOD_COMPARE === "1";
}
