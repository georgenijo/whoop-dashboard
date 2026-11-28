import { shiftDate } from "./range";

// ---------------------------------------------------------------------------
// Stats range pills — shared by `/stats` and `/stats/[sport]` (issue #430) so
// a drill-down opened from a ranged Stats page shows the same window. Extends
// the dashboard's `?range=` pattern with stats-specific windows. Default is
// the current calendar year.
// ---------------------------------------------------------------------------
export type StatsRange = "30d" | "90d" | "ytd" | "year" | "all";
export const STATS_RANGE_KEYS: StatsRange[] = ["30d", "90d", "ytd", "year", "all"];

export type StatsRangeWindow = {
  range: StatsRange;
  start: string;
  end: string;
  label: string;
};

export function resolveStatsRange(
  raw: string | undefined,
  year: number,
  today: string,
): StatsRangeWindow {
  const range: StatsRange = STATS_RANGE_KEYS.includes(raw as StatsRange)
    ? (raw as StatsRange)
    : "year";
  switch (range) {
    case "30d":
      return { range, start: shiftDate(today, -29), end: today, label: "Last 30 days" };
    case "90d":
      return { range, start: shiftDate(today, -89), end: today, label: "Last 90 days" };
    case "ytd":
      return { range, start: `${year}-01-01`, end: today, label: "Year to date" };
    case "all":
      return { range, start: "1970-01-01", end: today, label: "All-time" };
    case "year":
    default:
      return { range, start: `${year}-01-01`, end: today, label: String(year) };
  }
}

export function statsRangePillLabel(k: StatsRange, year: number): string {
  return k === "ytd" ? "YTD" : k === "year" ? String(year) : k === "all" ? "All" : k.toUpperCase();
}

// ---------------------------------------------------------------------------
// Sport ⇄ URL segment. Whoop sport names carry spaces, slashes and ampersands
// ("Functional Fitness", "HIIT/Circuit", "Box & Weights"), so the segment is
// `encodeURIComponent`-encoded — a raw "/" would otherwise split the route.
// The label "Unknown" is what the Stats aggregations show for NULL-sport rows
// (`COALESCE(sport, 'Unknown')`), and the sport filter matches the same
// expression, so the Unknown row round-trips too.
// ---------------------------------------------------------------------------
export function sportStatsHref(sport: string, range?: StatsRange): string {
  const base = `/stats/${encodeURIComponent(sport)}`;
  return range ? `${base}?range=${range}` : base;
}

/**
 * Recover the sport label from the `[sport]` route param. Whether the router
 * hands the segment over decoded or still percent-encoded isn't documented
 * for this Next version, so decode only when an escape is present and keep
 * the raw value when it is malformed (a literal "%" in an already-decoded
 * name). Returns `null` for an empty/blank segment.
 */
export function sportFromParam(raw: string): string | null {
  let value = raw;
  if (/%[0-9a-f]{2}/i.test(value)) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // malformed escape — the segment was already decoded; keep it
    }
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Per-sport summary strip — folds the already-fetched session rows, so the
// drill-down's headline numbers can never disagree with the list beneath it.
// Means skip sessions missing that metric; null when none carry it.
// ---------------------------------------------------------------------------
export type SportSessionSummary = {
  sessions: number;
  activeSeconds: number | null;
  avgStrain: number | null;
  avgHr: number | null;
};

type SummarizableRow = {
  duration_sec: number | null;
  strain: number | null;
  avg_hr: number | null;
};

export function summarizeSportSessions(rows: SummarizableRow[]): SportSessionSummary {
  let dur = 0;
  let durN = 0;
  let strain = 0;
  let strainN = 0;
  let hr = 0;
  let hrN = 0;
  for (const r of rows) {
    if (r.duration_sec != null) {
      dur += r.duration_sec;
      durN++;
    }
    if (r.strain != null) {
      strain += r.strain;
      strainN++;
    }
    if (r.avg_hr != null) {
      hr += r.avg_hr;
      hrN++;
    }
  }
  return {
    sessions: rows.length,
    activeSeconds: durN ? dur : null,
    avgStrain: strainN ? strain / strainN : null,
    avgHr: hrN ? hr / hrN : null,
  };
}
