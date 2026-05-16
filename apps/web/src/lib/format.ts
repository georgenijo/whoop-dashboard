export type Zone = "green" | "yellow" | "red";

/** Recovery zones from colors_and_type.css:56-58 (>66 green, 33-66 yellow, <33 red). */
export function recoveryZone(score: number | null | undefined): Zone {
  if (score == null) return "green";
  if (score >= 67) return "green";
  if (score >= 34) return "yellow";
  return "red";
}

export function recoveryZoneLabel(zone: Zone): string {
  if (zone === "green") return "Green · primed to train";
  if (zone === "yellow") return "Yellow · moderate day";
  return "Red · prioritize recovery";
}

export function recoveryZoneColor(zone: Zone): string {
  if (zone === "green") return "var(--zone-green)";
  if (zone === "yellow") return "var(--zone-yellow)";
  return "var(--zone-red)";
}

export function recoveryZoneGradientStops(zone: Zone): [string, string] {
  if (zone === "green") return ["#00d4aa", "#00aa88"];
  if (zone === "yellow") return ["#ffaa00", "#cc8800"];
  return ["#ff4444", "#cc3333"];
}

/** Render the trailing date-context suffix on a KPI delta. When both dates
 * are known and exactly 1 day apart it's "vs yesterday"; when >1 day apart
 * it's "vs N days ago"; when the previous date is unknown (or dates can't
 * be parsed) it's "vs prev" — never silently lies about the comparison
 * being adjacent (issue #375). */
function deltaSinceLabel(
  latestDate: string | undefined,
  previousDate: string | undefined
): string {
  if (!latestDate || !previousDate) return "vs prev";
  const a = Date.parse(latestDate + "T00:00:00");
  const b = Date.parse(previousDate + "T00:00:00");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "vs prev";
  const diffDays = Math.round((a - b) / (1000 * 60 * 60 * 24));
  if (diffDays <= 1) return "vs yesterday";
  return `vs ${diffDays} days ago`;
}

/** Format a day-over-day delta; returns `{ label, dir }` for the `.delta` CSS.
 * Pass `latestDate` + `previousDate` (YYYY-MM-DD) so the suffix reflects
 * the actual gap rather than always claiming "vs yesterday". */
export function formatDelta(
  latest: number | null | undefined,
  previous: number | null | undefined,
  opts: {
    unit?: string;
    precision?: number;
    reverse?: boolean;
    latestDate?: string;
    previousDate?: string;
  } = {}
): { label: string; dir: "up" | "down" | "flat" } {
  if (latest == null || previous == null) return { label: "—", dir: "flat" };
  const diff = latest - previous;
  const precision = opts.precision ?? 1;
  const abs = Math.abs(diff);
  if (abs < Math.pow(10, -precision) / 2) {
    return { label: "— baseline", dir: "flat" };
  }
  // reverse=true: lower is better (e.g. RHR), so a drop shows as "up".
  const isImprovement = opts.reverse ? diff < 0 : diff > 0;
  const arrow = diff > 0 ? "↑" : "↓";
  const unit = opts.unit ?? "";
  const since = deltaSinceLabel(opts.latestDate, opts.previousDate);
  return {
    label: `${arrow} ${abs.toFixed(precision)}${unit} ${since}`,
    dir: isImprovement ? "up" : "down",
  };
}

/** Convert kilojoules to kilocalories (1 kJ ≈ 0.239 kcal). */
export function kJToKcal(kj: number | null | undefined): number | null {
  if (kj == null || !Number.isFinite(kj)) return null;
  return kj * 0.239;
}

export function formatHours(ms: number | null | undefined, precision = 1): string {
  if (ms == null) return "—";
  return (ms / (1000 * 60 * 60)).toFixed(precision);
}

export function msToHoursNumber(ms: number | null | undefined): number | null {
  if (ms == null) return null;
  return ms / (1000 * 60 * 60);
}

export function formatUpdatedAt(date: string | null | undefined): string {
  if (!date) return "No recent sync";
  // `date` is YYYY-MM-DD from SQLite.
  const d = new Date(date + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return `${diffDays}d ago`;
}
