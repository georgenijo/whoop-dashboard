// DATA_EXPORT=1 turns on the user-owned data export: GET /api/export and the
// "Export my data" card on /settings. Anything else (unset, "0", "true")
// is OFF — the route 404s before auth or any DB read, and the card is not
// rendered. Read per call (not at module load) so tests and a restarted
// service see the current env.
export function isDataExportEnabled(): boolean {
  return process.env.DATA_EXPORT === "1";
}
