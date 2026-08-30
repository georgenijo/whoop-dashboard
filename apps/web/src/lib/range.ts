export type Range = "7d" | "14d" | "30d" | "90d" | "all";

export type RangeWindow = {
  days: number;
  start: string;
  end: string;
  label: string;
};

export function parseDays(range: string | undefined): number {
  return { "7d": 7, "14d": 14, "30d": 30, "90d": 90, "all": 9999 }[range ?? "30d"] ?? 30;
}

export function formatRangeLabel(range: string | undefined): string {
  // `undefined` must mirror parseDays(undefined) = 30 — without this match,
  // pages with no `?range=` param show "all-time" while only loading 30d
  // of data (issue #376).
  if (range === "all") return "all-time";
  if (!range) return "30 days";
  return `${range.replace("d", "")} days`;
}

/** Shift an ISO calendar date without involving the runtime timezone. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve the page picker to an inclusive calendar window. "7d" means today
 * plus the preceding six dates, not seven rows and not eight inclusive dates.
 */
export function resolveRangeWindow(
  range: string | undefined,
  today: string,
): RangeWindow {
  const normalized = (["7d", "14d", "30d", "90d", "all"] as const)
    .includes(range as Range)
    ? range as Range
    : undefined;
  const days = parseDays(normalized);
  return {
    days,
    start: days === 9999 ? "0000-01-01" : shiftDate(today, -(days - 1)),
    end: today,
    label: formatRangeLabel(normalized),
  };
}
