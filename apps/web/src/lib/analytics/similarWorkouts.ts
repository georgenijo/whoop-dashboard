/**
 * "Compare with similar workouts" — pure comparison of one session against the
 * user's recent sessions of the same sport and similar duration.
 *
 * No I/O. Callers hand in rows they already read through the user-scoped
 * readers (`getSimilarWorkoutCandidates` for the detail page, the page's
 * existing range rows for the table chip), so tenant isolation is inherited
 * from the read, never re-derived here.
 *
 * Units: Whoop stores distance in metres and duration in seconds; zones in
 * milliseconds. Everything is normalised here (km, sec/km, zone share of the
 * session's own zone total) so sessions recorded with/without distance, or with
 * zone totals that don't match `duration_sec`, still compare like-for-like.
 */

/** Minimal row shape — a structural subset of `WorkoutRow`. */
export type SimilarWorkoutInput = {
  id: string;
  date: string; // YYYY-MM-DD, user-local day as stored by sync
  sport: string | null;
  duration_sec: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  strain: number | null;
  distance_m: number | null;
  zone_0_ms: number | null;
  zone_1_ms: number | null;
  zone_2_ms: number | null;
  zone_3_ms: number | null;
  zone_4_ms: number | null;
  zone_5_ms: number | null;
  start_utc?: string | null;
};

export const MAX_SIMILAR = 5;
/** ±25% of the session's own duration. */
export const DURATION_TOLERANCE = 0.25;
/** Below this a session is a warm-up / accidental start; comparisons are noise. */
export const MIN_COMPARABLE_SEC = 5 * 60;
/** How far back the detail-page reader looks for candidates. */
export const LOOKBACK_DAYS = 365;

// Verdict thresholds. Avg HR moves a few bpm session to session, strain is
// logarithmic and noisier — hence the asymmetric bands.
const HR_BAND_PCT = 3;
const STRAIN_BAND = 1.0;

const ZONE_KEYS = [
  "zone_0_ms",
  "zone_1_ms",
  "zone_2_ms",
  "zone_3_ms",
  "zone_4_ms",
  "zone_5_ms",
] as const;

export type MetricKey = "avg_hr" | "max_hr" | "strain" | "distance_km" | "pace_sec_per_km";

export type MetricComparison = {
  key: MetricKey;
  current: number | null;
  /** Mean over the similar sessions that have this metric; null if none do. */
  baseline: number | null;
  /** current − baseline; null when either side is missing. */
  delta: number | null;
  /** How many of the similar sessions contributed to the baseline. */
  n: number;
};

/** Share of in-zone time, 0–100, bucketed easy (Z0–2) / moderate (Z3) / hard (Z4–5). */
export type ZoneMix = { easy: number; moderate: number; hard: number };

export type Verdict =
  | "higher-intensity"
  | "lower-intensity"
  | "typical"
  | "mixed";

export type SimilarWorkoutsResult =
  | { status: "too-short"; sport: string | null }
  | { status: "no-duration"; sport: string | null }
  | {
      status: "first-of-sport";
      sport: string | null;
      /** Same-sport sessions exist but none were within ±25% duration. */
      sameSportCount: number;
      monthNote: MonthNote | null;
    }
  | {
      status: "ok";
      sport: string | null;
      similar: SimilarWorkoutInput[];
      metrics: MetricComparison[];
      zones: { current: ZoneMix | null; baseline: ZoneMix | null; n: number };
      verdict: Verdict;
      /** Plain-language one-liners, most important first. */
      notes: string[];
      monthNote: MonthNote | null;
    };

export type MonthNote = { kind: "longest" | "tied-longest"; others: number };

// ---- small helpers ----------------------------------------------------------

function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function positive(v: number | null | undefined): number | null {
  const n = num(v);
  return n != null && n > 0 ? n : null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** `null` sport groups with `null` sport, compared case-insensitively. */
function sportKey(s: string | null): string {
  return (s ?? "").trim().toLowerCase();
}

/**
 * Chronological order key. Prefer the UTC start instant (unambiguous across
 * DST and timezone changes); fall back to the stored local date at noon UTC so
 * rows without `start_utc` still sort by day.
 */
function orderKey(w: SimilarWorkoutInput): number {
  if (w.start_utc) {
    const t = Date.parse(w.start_utc);
    if (Number.isFinite(t)) return t;
  }
  const t = Date.parse(`${w.date}T12:00:00Z`);
  return Number.isFinite(t) ? t : 0;
}

/** Strictly-before comparison with a deterministic id tiebreak. */
export function isBefore(a: SimilarWorkoutInput, b: SimilarWorkoutInput): boolean {
  const ka = orderKey(a);
  const kb = orderKey(b);
  if (ka !== kb) return ka < kb;
  if (a.date !== b.date) return a.date < b.date;
  return a.id < b.id;
}

export function distanceKm(w: SimilarWorkoutInput): number | null {
  const m = positive(w.distance_m);
  return m != null ? m / 1000 : null;
}

/** Seconds per km; null without both a distance and a duration. */
export function paceSecPerKm(w: SimilarWorkoutInput): number | null {
  const km = distanceKm(w);
  const sec = positive(w.duration_sec);
  if (km == null || sec == null) return null;
  // < 10 m of distance gives absurd paces — treat as not recorded.
  if (km < 0.01) return null;
  return sec / km;
}

export function zoneMix(w: SimilarWorkoutInput): ZoneMix | null {
  const ms = ZONE_KEYS.map((k) => Math.max(0, num(w[k]) ?? 0));
  const total = ms.reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  const pct = (v: number) => (v / total) * 100;
  return {
    easy: pct(ms[0] + ms[1] + ms[2]),
    moderate: pct(ms[3]),
    hard: pct(ms[4] + ms[5]),
  };
}

function isSimilarDuration(candidateSec: number | null, targetSec: number): boolean {
  if (candidateSec == null) return false;
  return Math.abs(candidateSec - targetSec) <= targetSec * DURATION_TOLERANCE + 1e-9;
}

// ---- core -------------------------------------------------------------------

/**
 * Pick up to `MAX_SIMILAR` most-recent sessions that are strictly earlier than
 * `target`, same sport, and within ±25% of its duration.
 */
export function pickSimilar(
  target: SimilarWorkoutInput,
  pool: readonly SimilarWorkoutInput[],
  max = MAX_SIMILAR,
): SimilarWorkoutInput[] {
  const dur = positive(target.duration_sec);
  if (dur == null) return [];
  const key = sportKey(target.sport);
  return pool
    .filter(
      (w) =>
        w.id !== target.id &&
        sportKey(w.sport) === key &&
        isBefore(w, target) &&
        isSimilarDuration(positive(w.duration_sec), dur),
    )
    .sort((a, b) => (isBefore(a, b) ? 1 : isBefore(b, a) ? -1 : 0))
    .slice(0, max);
}

function compareMetric(
  key: MetricKey,
  current: number | null,
  baselineValues: (number | null)[],
): MetricComparison {
  const vals = baselineValues.filter((v): v is number => v != null);
  const baseline = mean(vals);
  return {
    key,
    current,
    baseline,
    delta: current != null && baseline != null ? current - baseline : null,
    n: vals.length,
  };
}

/** Longest-in-calendar-month check across every same-sport row in the pool. */
export function monthNoteFor(
  target: SimilarWorkoutInput,
  pool: readonly SimilarWorkoutInput[],
): MonthNote | null {
  const dur = positive(target.duration_sec);
  if (dur == null) return null;
  const month = target.date.slice(0, 7);
  const key = sportKey(target.sport);
  const others = pool.filter(
    (w) => w.id !== target.id && sportKey(w.sport) === key && w.date.slice(0, 7) === month,
  );
  // A month with one session trivially makes it "the longest"; say nothing.
  if (others.length === 0) return null;
  let tied = false;
  for (const w of others) {
    const d = positive(w.duration_sec);
    if (d == null) continue;
    // Whole-second resolution: Whoop durations are derived from timestamps.
    if (Math.round(d) > Math.round(dur)) return null;
    if (Math.round(d) === Math.round(dur)) tied = true;
  }
  return { kind: tied ? "tied-longest" : "longest", others: others.length };
}

function classify(metrics: MetricComparison[]): Verdict {
  const hr = metrics.find((m) => m.key === "avg_hr");
  const strain = metrics.find((m) => m.key === "strain");
  const signals: number[] = [];
  if (hr?.delta != null && hr.baseline) {
    const pct = (hr.delta / hr.baseline) * 100;
    signals.push(pct >= HR_BAND_PCT ? 1 : pct <= -HR_BAND_PCT ? -1 : 0);
  }
  if (strain?.delta != null) {
    signals.push(strain.delta >= STRAIN_BAND ? 1 : strain.delta <= -STRAIN_BAND ? -1 : 0);
  }
  if (signals.length === 0) return "typical";
  const up = signals.some((s) => s > 0);
  const down = signals.some((s) => s < 0);
  if (up && down) return "mixed";
  if (up) return "higher-intensity";
  if (down) return "lower-intensity";
  return "typical";
}

const VERDICT_TEXT: Record<Verdict, string> = {
  "higher-intensity": "Higher intensity than usual",
  "lower-intensity": "Easier than usual",
  typical: "In line with your usual",
  mixed: "Mixed: heart rate and strain disagree",
};

export function verdictText(v: Verdict): string {
  return VERDICT_TEXT[v];
}

function sportLabel(sport: string | null): string {
  const s = (sport ?? "").trim();
  return s ? s.toLowerCase() : "session";
}

function monthNoteText(note: MonthNote, sport: string | null): string {
  return note.kind === "longest"
    ? `Longest ${sportLabel(sport)} this month`
    : `Tied for longest ${sportLabel(sport)} this month`;
}

export function compareSimilarWorkouts(
  target: SimilarWorkoutInput,
  pool: readonly SimilarWorkoutInput[],
): SimilarWorkoutsResult {
  const dur = positive(target.duration_sec);
  if (dur == null) return { status: "no-duration", sport: target.sport };
  if (dur < MIN_COMPARABLE_SEC) return { status: "too-short", sport: target.sport };

  const monthNote = monthNoteFor(target, pool);
  const similar = pickSimilar(target, pool);
  if (similar.length === 0) {
    const key = sportKey(target.sport);
    const sameSportCount = pool.filter(
      (w) => w.id !== target.id && sportKey(w.sport) === key && isBefore(w, target),
    ).length;
    return { status: "first-of-sport", sport: target.sport, sameSportCount, monthNote };
  }

  const metrics: MetricComparison[] = [
    compareMetric("avg_hr", positive(target.avg_hr), similar.map((w) => positive(w.avg_hr))),
    compareMetric("max_hr", positive(target.max_hr), similar.map((w) => positive(w.max_hr))),
    compareMetric("strain", num(target.strain), similar.map((w) => num(w.strain))),
    compareMetric("distance_km", distanceKm(target), similar.map(distanceKm)),
    compareMetric("pace_sec_per_km", paceSecPerKm(target), similar.map(paceSecPerKm)),
  ];

  const currentZones = zoneMix(target);
  const baselineMixes = similar.map(zoneMix).filter((z): z is ZoneMix => z != null);
  const baselineZones: ZoneMix | null =
    baselineMixes.length > 0
      ? {
          easy: mean(baselineMixes.map((z) => z.easy))!,
          moderate: mean(baselineMixes.map((z) => z.moderate))!,
          hard: mean(baselineMixes.map((z) => z.hard))!,
        }
      : null;

  const verdict = classify(metrics);
  const notes: string[] = [verdictText(verdict)];
  if (monthNote) notes.push(monthNoteText(monthNote, target.sport));
  if (currentZones && baselineZones) {
    const d = currentZones.hard - baselineZones.hard;
    if (d >= 10) notes.push(`${Math.round(d)} pts more time in Z4–5`);
    else if (d <= -10) notes.push(`${Math.round(-d)} pts less time in Z4–5`);
  }
  const pace = metrics.find((m) => m.key === "pace_sec_per_km");
  if (pace?.delta != null && pace.baseline) {
    const pct = (pace.delta / pace.baseline) * 100;
    if (pct <= -3) notes.push("Faster pace than usual");
    else if (pct >= 3) notes.push("Slower pace than usual");
  }

  return {
    status: "ok",
    sport: target.sport,
    similar,
    metrics,
    zones: { current: currentZones, baseline: baselineZones, n: baselineMixes.length },
    verdict,
    notes,
    monthNote,
  };
}

// ---- table chip ---------------------------------------------------------------

export type VsUsualChip = { verdict: Verdict; n: number; label: string };

const CHIP_LABEL: Record<Verdict, string> = {
  "higher-intensity": "↑ harder",
  "lower-intensity": "↓ easier",
  typical: "≈ usual",
  mixed: "± mixed",
};

/**
 * One chip per row, computed only from the rows the page already loaded. Rows
 * with nothing to compare against get no entry (the table renders nothing).
 * O(n²) worst case over the page's range — bounded by the range itself, and a
 * year of workouts is a few hundred rows.
 */
export function computeVsUsualChips(
  rows: readonly SimilarWorkoutInput[],
): Record<string, VsUsualChip> {
  const out: Record<string, VsUsualChip> = {};
  for (const row of rows) {
    const r = compareSimilarWorkouts(row, rows);
    if (r.status !== "ok") continue;
    out[row.id] = { verdict: r.verdict, n: r.similar.length, label: CHIP_LABEL[r.verdict] };
  }
  return out;
}

// ---- formatting (shared by card + tests) -------------------------------------

export function formatPace(secPerKm: number | null): string {
  if (secPerKm == null || !Number.isFinite(secPerKm)) return "—";
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}/km`;
}

/** Earliest date (YYYY-MM-DD) the detail-page reader should look back to. */
export function lookbackStart(date: string, days = LOOKBACK_DAYS): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) return date;
  // UTC arithmetic on a date-only value: no DST shifts can move the day.
  return new Date(t - days * 86_400_000).toISOString().slice(0, 10);
}

/** Last day of the session's calendar month — the reader's upper bound. */
export function monthEnd(date: string): string {
  const [y, m] = date.split("-").map(Number);
  if (!y || !m) return date;
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
