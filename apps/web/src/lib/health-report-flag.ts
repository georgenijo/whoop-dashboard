/**
 * HEALTH_REPORT=1 turns on the printable health summary at /report and its
 * nav entries. Read per request (not at module load) so a restart with the env
 * changed is all it takes, and so tests can stub it. Only the exact string "1"
 * enables it; "true", "yes", "0" and unset all leave it off.
 */
export function isHealthReportEnabled(): boolean {
  return process.env.HEALTH_REPORT === "1";
}
