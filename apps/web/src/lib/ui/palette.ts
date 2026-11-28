// Pure logic for the Cmd/Ctrl-K quick-jump palette (COMMAND_PALETTE=1).
//
// Everything here is synchronous computation over static data and two strings
// the caller supplies (the current pathname and the viewer's local calendar
// date). No network, no DB reads, no clock reads: `today` is passed in so the
// date parser is deterministic and testable across month/year/DST boundaries.
// Dates are handled as ISO `YYYY-MM-DD` strings with UTC arithmetic, so a DST
// transition in the viewer's zone can never shift a calendar day.

export type PaletteGroup = "Jump to" | "Actions" | "Date";

export type PaletteItem = {
  id: string;
  label: string;
  href: string;
  group: PaletteGroup;
  /** Extra words the fuzzy matcher also considers (synonyms, metrics). */
  keywords?: string[];
  /** Short secondary text shown on the right of the row. */
  hint?: string;
};

export type Range = "7d" | "14d" | "30d" | "90d" | "all";
const RANGES: readonly Range[] = ["7d", "14d", "30d", "90d", "all"];

/** Pages whose server component honours `?range=` (mirrors TopBar's picker). */
export const RANGE_PAGES: ReadonlySet<string> = new Set([
  "/",
  "/recovery",
  "/sleep",
  "/strain",
  "/steps",
  "/workouts",
]);

type Destination = {
  href: string;
  label: string;
  keywords: string[];
};

// Mirrors Sidebar.tsx (`nav` + `secondary`). There are no flag-gated pages on
// main yet; when one lands, add it here behind its own flag check so the
// palette never advertises a page that would 404.
export const DESTINATIONS: readonly Destination[] = [
  { href: "/", label: "Overview", keywords: ["home", "dashboard", "summary"] },
  { href: "/recovery", label: "Recovery", keywords: ["hrv", "rhr", "resting heart rate", "readiness"] },
  { href: "/sleep", label: "Sleep", keywords: ["stages", "rem", "deep", "efficiency", "bed"] },
  { href: "/strain", label: "Strain", keywords: ["load", "kj", "calories", "effort"] },
  { href: "/workouts", label: "Workouts", keywords: ["exercise", "training", "sessions", "activity"] },
  { href: "/stats", label: "Stats", keywords: ["statistics", "sports", "totals"] },
  { href: "/coach", label: "Coach", keywords: ["chat", "ai", "ask", "assistant"] },
  { href: "/plans", label: "Plans", keywords: ["program", "schedule", "goals"] },
  { href: "/logs", label: "Logs", keywords: ["sync", "history", "errors"] },
  { href: "/perf", label: "Performance", keywords: ["latency", "web vitals", "speed"] },
  { href: "/settings", label: "Settings", keywords: ["preferences", "account", "whoop", "connect"] },
];

/** Dashboard pages a typed date can open (all are range-aware). */
const DATE_TARGETS: readonly Destination[] = DESTINATIONS.filter(
  (d) => RANGE_PAGES.has(d.href),
);

const RANGE_LABEL: Record<Range, string> = {
  "7d": "last 7 days",
  "14d": "last 14 days",
  "30d": "last 30 days",
  "90d": "last 90 days",
  all: "all time",
};

export function isRange(value: string | null | undefined): value is Range {
  return typeof value === "string" && (RANGES as readonly string[]).includes(value);
}

function withRange(href: string, range: Range | null): string {
  return range && RANGE_PAGES.has(href) ? `${href}?range=${range}` : href;
}

// ── Fuzzy matching ──────────────────────────────────────────────────────────

/**
 * Subsequence fuzzy score of `query` against `text`, case-insensitive.
 * Returns null when not every query character appears in order. Higher is
 * better: contiguous runs, word-start hits and a prefix match score most, and
 * shorter targets win ties. Whitespace in the query is ignored.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    let s = 1;
    if (found === prev + 1) s += 5; // contiguous run
    if (found === 0) s += 8; // prefix
    else if (/[\s\-/_.]/.test(t[found - 1])) s += 6; // word start
    score += s;
    prev = found;
    ti = found + 1;
  }
  // Prefer tighter matches and shorter labels.
  return score - (t.length - q.length) * 0.05;
}

function itemScore(query: string, item: PaletteItem): number | null {
  const label = fuzzyScore(query, item.label);
  let best = label === null ? null : label + 2; // label hits beat keyword hits
  for (const k of item.keywords ?? []) {
    const s = fuzzyScore(query, k);
    if (s !== null && (best === null || s > best)) best = s;
  }
  return best;
}

/**
 * Filter + rank `items` by `query`. An empty query returns the list unchanged.
 * Ties keep the original order (Array#sort is stable).
 */
export function filterItems(items: readonly PaletteItem[], query: string): PaletteItem[] {
  if (!query.trim()) return [...items];
  const scored: { item: PaletteItem; score: number }[] = [];
  for (const item of items) {
    const score = itemScore(query.trim(), item);
    if (score !== null) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}

// ── Date parsing ────────────────────────────────────────────────────────────

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in `YYYY-MM-DD` form (rejects 2026-02-30). */
export function isValidIsoDate(value: string): boolean {
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return (
    d.getUTCFullYear() === +m[1] &&
    d.getUTCMonth() === +m[2] - 1 &&
    d.getUTCDate() === +m[3]
  );
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fromIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function shiftIso(iso: string, days: number): string {
  const d = fromIso(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** Whole calendar days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((fromIso(b).getTime() - fromIso(a).getTime()) / 86_400_000);
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function matchPrefixName(word: string, names: string[], min = 3): number {
  if (word.length < min) return -1;
  // "sept" is a common abbreviation that isn't a strict prefix problem, but
  // "tues"/"thur"/"thurs" are; all are prefixes, so a prefix test covers them.
  return names.findIndex((n) => n.startsWith(word));
}

function weekdayOf(iso: string): number {
  return fromIso(iso).getUTCDay();
}

/** Most recent date ≤ today (or < today when `strict`) falling on `weekday`. */
function previousWeekday(today: string, weekday: number, strict: boolean): string {
  let back = (weekdayOf(today) - weekday + 7) % 7;
  if (back === 0 && strict) back = 7;
  return shiftIso(today, -back);
}

function buildIso(year: number, month0: number, day: number): string | null {
  const iso = `${String(year).padStart(4, "0")}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidIsoDate(iso) ? iso : null;
}

/** Month/day with no year resolves to its most recent occurrence ≤ today. */
function monthDayNoYear(today: string, month0: number, day: number): string | null {
  const year = +today.slice(0, 4);
  const thisYear = buildIso(year, month0, day);
  if (thisYear && thisYear <= today) return thisYear;
  // Feb 29 in a non-leap current year, or a later date this year: walk back
  // to the most recent year where it exists (≤ 8 years covers any leap gap).
  for (let y = year - 1; y >= year - 8; y--) {
    const iso = buildIso(y, month0, day);
    if (iso) return iso;
  }
  return null;
}

/**
 * Parse a typed date relative to `today` (the viewer's local `YYYY-MM-DD`).
 * Accepts: `2026-11-02`, `today`, `yesterday`, `3 days ago` / `3d ago`,
 * `monday` / `mon` (most recent, today included), `last monday` (strictly
 * before today), `nov 2`, `november 2`, `2 nov`, `nov 2 2025`, `nov 2, 2025`.
 * Returns null for anything else, including impossible dates.
 */
export function parseDateQuery(query: string, today: string): string | null {
  if (!isValidIsoDate(today)) return null;
  const q = query.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!q) return null;

  if (ISO_RE.test(q)) return isValidIsoDate(q) ? q : null;
  if (q === "today") return today;
  if (q === "yesterday") return shiftIso(today, -1);

  const ago = /^(\d{1,4}) ?(?:d|days?) ago$/.exec(q);
  if (ago) return shiftIso(today, -Number(ago[1]));

  const words = q.split(" ");

  if (words.length <= 2) {
    const strict = words.length === 2 && words[0] === "last";
    const wd = words.length === 1 || strict ? matchPrefixName(words[words.length - 1], WEEKDAYS) : -1;
    if (wd !== -1) return previousWeekday(today, wd, strict);
  }

  // "nov 2" / "2 nov" with optional trailing 4-digit year.
  if (words.length === 2 || words.length === 3) {
    let month = -1;
    let day = NaN;
    if (/^\d{1,2}$/.test(words[1])) {
      month = matchPrefixName(words[0], MONTHS);
      day = Number(words[1]);
    } else if (/^\d{1,2}$/.test(words[0])) {
      month = matchPrefixName(words[1], MONTHS);
      day = Number(words[0]);
    }
    if (month === -1 || !Number.isFinite(day)) return null;
    if (words.length === 3) {
      if (!/^\d{4}$/.test(words[2])) return null;
      return buildIso(Number(words[2]), month, day);
    }
    return monthDayNoYear(today, month, day);
  }

  return null;
}

/**
 * Smallest picker range whose inclusive window (today and the preceding
 * N−1 days, see `resolveRangeWindow`) contains `date`. Null for future dates.
 */
export function rangeCovering(date: string, today: string): Range | null {
  const back = daysBetween(date, today);
  if (back < 0) return null;
  if (back < 7) return "7d";
  if (back < 14) return "14d";
  if (back < 30) return "30d";
  if (back < 90) return "90d";
  return "all";
}

export function formatDateLabel(iso: string, today: string): string {
  const d = fromIso(iso);
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Items offered for a typed date, or [] when it doesn't parse / is future. */
export function dateItems(query: string, today: string): PaletteItem[] {
  const date = parseDateQuery(query, today);
  if (!date) return [];
  const range = rangeCovering(date, today);
  if (!range) return [];
  const label = formatDateLabel(date, today);
  return DATE_TARGETS.map((t) => ({
    id: `date:${t.href}:${date}`,
    label: `${t.label} around ${label}`,
    href: withRange(t.href, range),
    group: "Date" as const,
    hint: RANGE_LABEL[range],
  }));
}

// ── Assembly ────────────────────────────────────────────────────────────────

export type PaletteContext = {
  pathname: string;
  /** Current `?range=` value, preserved on dashboard jumps like the sidebar. */
  range: string | null;
};

/** Static destinations + quick actions for the current page. */
export function baseItems(ctx: PaletteContext): PaletteItem[] {
  const current = isRange(ctx.range) ? ctx.range : null;
  const pages: PaletteItem[] = DESTINATIONS.map((d) => ({
    id: `page:${d.href}`,
    label: d.label,
    href: withRange(d.href, current),
    group: "Jump to",
    keywords: d.keywords,
    hint: d.href === ctx.pathname ? "Current page" : undefined,
  }));

  // Range actions apply to the current page when it is range-aware, else to
  // Overview, so they always do something visible.
  const rangeTarget = RANGE_PAGES.has(ctx.pathname) ? ctx.pathname : "/";
  const targetLabel = DESTINATIONS.find((d) => d.href === rangeTarget)?.label ?? "Overview";
  const actions: PaletteItem[] = [
    {
      id: "action:today",
      label: "Go to today",
      href: "/?range=7d",
      group: "Actions",
      keywords: ["now", "latest", "this morning"],
      hint: "Overview · last 7 days",
    },
    ...RANGES.map((r) => ({
      id: `action:range:${r}`,
      label: `Show ${RANGE_LABEL[r]}`,
      href: `${rangeTarget}?range=${r}`,
      group: "Actions" as const,
      keywords: [r, "range", "period", "window"],
      hint: targetLabel,
    })),
  ];
  return [...pages, ...actions];
}

export const MAX_RESULTS = 30;

/**
 * Everything the palette should show for `query`: date jumps first (when the
 * query parses as a past or present date), then fuzzy-ranked pages/actions.
 */
export function paletteResults(query: string, ctx: PaletteContext, today: string): PaletteItem[] {
  const dates = dateItems(query, today);
  const rest = filterItems(baseItems(ctx), query);
  return [...dates, ...rest].slice(0, MAX_RESULTS);
}

/** Viewer-local `YYYY-MM-DD` for a Date (client-side; not UTC). */
export function localIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
