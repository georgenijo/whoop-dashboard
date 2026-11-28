/**
 * Event markers for the /recovery trend charts (CHART_MARKERS=1).
 *
 * Pure: takes rows the page already holds (recovery, cycles) plus the flag-only
 * workouts/journal reads, and returns at most one marker per (date, category).
 * Everything is keyed on the `YYYY-MM-DD` strings the DB stores; calendar
 * arithmetic goes through UTC midnights so a DST transition in the viewer's
 * zone can never shift, duplicate or drop a day.
 */

export type MarkerCategory = "workouts" | "journal" | "drops";
/** `high-strain` is a workouts-category day whose cycle strain is >= HIGH_STRAIN. */
export type MarkerKind = "workout" | "high-strain" | "journal" | "drop";
export type MarkerSize = "sm" | "md" | "lg";

export type ChartMarker = {
  date: string;
  category: MarkerCategory;
  kind: MarkerKind;
  size: MarkerSize;
  /** Human sentence naming the event(s); used for the tooltip and aria-label. */
  label: string;
};

export type PlacedMarker = ChartMarker & {
  /** 0..100 along the chart's x axis (same index scale the charts plot on). */
  xPct: number;
  /** >1 when neighbouring markers were merged so they stay tappable. */
  count: number;
  /** Last date covered (== date unless clustered). */
  endDate: string;
};

export type MarkerInputs = {
  start: string;
  end: string;
  recovery: { date: string; recovery_score: number | null }[];
  cycles: { date: string; strain: number | null }[];
  workouts: { date: string; sport: string | null; strain: number | null }[];
  journal: { date: string; title: string | null; tags: string | null; mood?: string | null }[];
};

export const MARKER_CATEGORIES: { key: MarkerCategory; label: string }[] = [
  { key: "workouts", label: "Workouts" },
  { key: "journal", label: "Journal" },
  { key: "drops", label: "Big drops" },
];

/** Whoop's "high" strain band starts at 14. */
export const HIGH_STRAIN = 14;
/** A day-over-day recovery fall of at least this many points is a "big drop". */
export const BIG_DROP_POINTS = 20;
/** Workouts below this strain draw small, at/above HIGH_STRAIN large. */
const MEDIUM_STRAIN = 10;
const JOURNAL_LABEL_MAX = 60;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function utcMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function isRealDate(date: string): boolean {
  if (!ISO_DATE.test(date)) return false;
  return new Date(utcMs(date)).toISOString().slice(0, 10) === date;
}

/** Whole calendar days from a to b (b later => positive). DST-proof. */
export function dayDiff(a: string, b: string): number {
  return Math.round((utcMs(b) - utcMs(a)) / DAY_MS);
}

/** "Sun, Nov 1" — formatted in UTC so the label is the stored day everywhere. */
export function formatMarkerDate(date: string): string {
  return new Date(utcMs(date)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function finite(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function inWindow(date: string, start: string, end: string): boolean {
  return isRealDate(date) && date >= start && date <= end;
}

function sportName(sport: string | null): string {
  const s = (sport ?? "").trim();
  if (!s) return "Workout";
  return s
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function strainSize(strain: number | null): MarkerSize {
  if (!finite(strain) || strain < MEDIUM_STRAIN) return "sm";
  return strain < HIGH_STRAIN ? "md" : "lg";
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function groupByDate<T extends { date: string }>(rows: T[], start: string, end: string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    if (!inWindow(row.date, start, end)) continue;
    const list = out.get(row.date);
    if (list) list.push(row);
    else out.set(row.date, [row]);
  }
  return out;
}

function workoutMarkers(inputs: MarkerInputs): ChartMarker[] {
  const { start, end } = inputs;
  const byDate = groupByDate(inputs.workouts, start, end);
  const dayStrain = new Map<string, number>();
  for (const c of inputs.cycles) {
    if (inWindow(c.date, start, end) && finite(c.strain)) dayStrain.set(c.date, c.strain);
  }
  const dates = new Set([...byDate.keys(), ...[...dayStrain].filter(([, s]) => s >= HIGH_STRAIN).map(([d]) => d)]);
  const out: ChartMarker[] = [];
  for (const date of dates) {
    const sessions = byDate.get(date) ?? [];
    const strain = dayStrain.get(date);
    const high = finite(strain) && strain >= HIGH_STRAIN;
    const parts = sessions.map((w) =>
      finite(w.strain) ? `${sportName(w.sport)} (strain ${w.strain.toFixed(1)})` : sportName(w.sport),
    );
    const maxWorkout = sessions.reduce<number | null>(
      (m, w) => (finite(w.strain) && (m == null || w.strain > m) ? w.strain : m),
      null,
    );
    const head = sessions.length === 0 ? "No logged workout" : parts.join(", ");
    const tail = high && finite(strain) ? ` · high-strain day ${strain.toFixed(1)}` : "";
    out.push({
      date,
      category: "workouts",
      kind: high ? "high-strain" : "workout",
      size: high ? "lg" : strainSize(maxWorkout),
      label: `${formatMarkerDate(date)}: ${head}${tail}`,
    });
  }
  return out;
}

function journalMarkers(inputs: MarkerInputs): ChartMarker[] {
  const out: ChartMarker[] = [];
  for (const [date, rows] of groupByDate(inputs.journal, inputs.start, inputs.end)) {
    const bits = rows
      .map((r) => [r.title, r.tags, r.mood].map((v) => (v ?? "").trim()).filter(Boolean).join(" · "))
      .filter(Boolean);
    const text = bits.length ? truncate(bits.join("; "), JOURNAL_LABEL_MAX) : "entry logged";
    out.push({
      date,
      category: "journal",
      kind: "journal",
      size: "md",
      label: `${formatMarkerDate(date)}: Journal — ${text}`,
    });
  }
  return out;
}

function dropMarkers(inputs: MarkerInputs): ChartMarker[] {
  const scores = new Map<string, number>();
  for (const r of inputs.recovery) {
    if (isRealDate(r.date) && finite(r.recovery_score)) scores.set(r.date, r.recovery_score);
  }
  const out: ChartMarker[] = [];
  const sorted = [...scores.keys()].sort();
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const date = sorted[i];
    // Only a true day-over-day fall counts; a gap could hide the slide.
    if (dayDiff(prev, date) !== 1 || !inWindow(date, inputs.start, inputs.end)) continue;
    const before = scores.get(prev)!;
    const after = scores.get(date)!;
    const fall = before - after;
    if (fall < BIG_DROP_POINTS) continue;
    out.push({
      date,
      category: "drops",
      kind: "drop",
      size: "md",
      label: `${formatMarkerDate(date)}: Recovery dropped ${Math.round(fall)} points (${Math.round(before)}% → ${Math.round(after)}%)`,
    });
  }
  return out;
}

const CATEGORY_ORDER: Record<MarkerCategory, number> = { workouts: 0, journal: 1, drops: 2 };

/** All markers in [start, end], sorted by date then category. */
export function buildChartMarkers(inputs: MarkerInputs): ChartMarker[] {
  if (!isRealDate(inputs.start) && inputs.start !== "0000-01-01") return [];
  if (!isRealDate(inputs.end) || inputs.start > inputs.end) return [];
  return [...workoutMarkers(inputs), ...journalMarkers(inputs), ...dropMarkers(inputs)].sort(
    (a, b) => (a.date === b.date ? CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] : a.date < b.date ? -1 : 1),
  );
}

const SIZE_RANK: Record<MarkerSize, number> = { sm: 0, md: 1, lg: 2 };

/**
 * Put markers on the chart's x scale. The charts plot valid points by index, so
 * a marker sits on the index of its date among `plottedDates`; a marker whose
 * date has no plotted point (no score that day) has nowhere honest to go and is
 * left off. Hidden categories are dropped. Within a category, markers closer
 * than `minGapPct` merge into one cluster so dense ranges stay legible and every
 * target stays tappable.
 */
export function placeMarkers(
  markers: ChartMarker[],
  plottedDates: string[],
  opts: { hidden?: ReadonlySet<MarkerCategory>; minGapPct?: number } = {},
): PlacedMarker[] {
  const n = plottedDates.length;
  if (n < 2) return [];
  const index = new Map(plottedDates.map((d, i) => [d, i]));
  const minGap = opts.minGapPct ?? 0;
  const out: PlacedMarker[] = [];
  for (const { key } of MARKER_CATEGORIES) {
    if (opts.hidden?.has(key)) continue;
    const lane = markers
      .filter((m) => m.category === key && index.has(m.date))
      .map((m) => ({ ...m, xPct: (index.get(m.date)! / (n - 1)) * 100, count: 1, endDate: m.date }))
      .sort((a, b) => a.xPct - b.xPct);
    let cluster: (PlacedMarker & { labels: string[] }) | null = null;
    for (const m of lane) {
      if (cluster && m.xPct - cluster.xPct < minGap) {
        cluster.count += 1;
        cluster.endDate = m.date;
        cluster.labels.push(m.label);
        if (SIZE_RANK[m.size] > SIZE_RANK[cluster.size]) cluster.size = m.size;
        if (m.kind === "high-strain") cluster.kind = "high-strain";
        continue;
      }
      if (cluster) out.push(finishCluster(cluster));
      cluster = { ...m, labels: [m.label] };
    }
    if (cluster) out.push(finishCluster(cluster));
  }
  return out;
}

function finishCluster(c: PlacedMarker & { labels: string[] }): PlacedMarker {
  const { labels, ...rest } = c;
  if (c.count === 1) return rest;
  const noun = c.category === "workouts" ? "workout days" : c.category === "journal" ? "journal entries" : "big drops";
  return {
    ...rest,
    label: `${c.count} ${noun}, ${formatMarkerDate(c.date)} – ${formatMarkerDate(c.endDate)}. ${labels.join(". ")}`,
  };
}
