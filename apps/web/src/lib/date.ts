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

/**
 * `YYYY-MM-DD` for `now` in an IANA timezone. Invalid/missing timezones fall
 * back to UTC so staleness checks can never throw on bad stored settings.
 */
export function dateInTimezone(
  now: Date,
  timeZone: string | null | undefined,
): string {
  const tz = timeZone?.trim();
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(now);
      const part = (type: "year" | "month" | "day") =>
        parts.find((item) => item.type === type)?.value;
      const year = part("year");
      const month = part("month");
      const day = part("day");
      if (year && month && day) return `${year}-${month}-${day}`;
    } catch {
      // Fall through to UTC.
    }
  }
  return now.toISOString().slice(0, 10);
}
