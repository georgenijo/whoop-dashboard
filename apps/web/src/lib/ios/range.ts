import "server-only";

// Strict range validation for the iOS API surface. `lib/range.ts:parseDays`
// is permissive (defaults to 30d on any unknown value) — fine for web URL
// params, but the iOS contract returns 400 on garbage so the app can surface
// the bad call. Keep this separate so the web behaviour is untouched.

export const IOS_RANGES = ["7d", "14d", "30d", "90d"] as const;
export type IosRange = (typeof IOS_RANGES)[number];

const RANGE_DAYS: Record<IosRange, number> = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "90d": 90,
};

export function parseRange(req: Request): { days: number; range: IosRange } | Response {
  const raw = new URL(req.url).searchParams.get("range") ?? "30d";
  if (!(IOS_RANGES as readonly string[]).includes(raw)) {
    return Response.json(
      { error: `Invalid range. Expected one of: ${IOS_RANGES.join(", ")}` },
      { status: 400 },
    );
  }
  const range = raw as IosRange;
  return { days: RANGE_DAYS[range], range };
}

export function rangeLabel(range: IosRange): string {
  return `${range.replace("d", "")} days`;
}

/** Local server date `YYYY-MM-DD` — same convention as the strain page. */
export function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
