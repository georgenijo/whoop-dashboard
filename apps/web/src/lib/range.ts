export type Range = "7d" | "14d" | "30d" | "90d" | "all";

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
