/**
 * Constants shared between server-only sync code and client UI. Lives in
 * its own module (no `server-only`) so client components like
 * `SyncLogsTable` can import without pulling the full sync runtime.
 */

/** Sentinel for partial syncs with no captured error text. */
export const PARTIAL_ERROR_FALLBACK = "partial";
