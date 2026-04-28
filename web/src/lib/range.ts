export type Range = "7d" | "14d" | "30d" | "90d" | "all";

export function parseDays(range: string | undefined): number {
  return { "7d": 7, "14d": 14, "30d": 30, "90d": 90, "all": 9999 }[range ?? "30d"] ?? 30;
}

export function formatRangeLabel(range: string | undefined): string {
  if (!range || range === "all") return "all-time";
  return `${range.replace("d", "")} days`;
}
