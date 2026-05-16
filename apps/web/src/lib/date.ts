import "server-only";

function format(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local server date `YYYY-MM-DD`. `toISOString().slice(0,10)` would return
 * the UTC date — east of UTC that hides today's data after evening (#373). */
export function localToday(): string {
  return format(new Date());
}

/** `YYYY-MM-DD` for the local date N days before today. */
export function localDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return format(d);
}
