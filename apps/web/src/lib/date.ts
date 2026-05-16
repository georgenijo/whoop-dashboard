/**
 * Server-side date helpers. Not `server-only`-tagged so server components
 * across (dashboard) routes can import without bundling drama; usages must
 * still be server-only by call-site convention (these read `new Date()` at
 * request time, never on the client).
 */

/** Local server date `YYYY-MM-DD`. Using `toISOString().slice(0,10)` hides
 * today's data for users east of UTC after their evening (issue #373). */
export function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
