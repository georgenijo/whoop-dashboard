// Pure model for the shareable daily snapshot card (`/share/today`,
// SHARE_CARD=1).
//
// No DB, no network, no clock: the caller passes `today` (already resolved
// in the user's tz) and the rows it read through the existing user-scoped
// readers. The per-day shaping reuses the Day detail model
// (`buildDayDetail`), so a number on the card always matches the same day's
// /day/[date] page.
//
// Privacy: the model carries no name, email, user id, record id, sport,
// journal text or any other free text from the database. Every string in it
// is produced here from numbers and fixed vocabulary, and is plain ASCII so
// the PNG renderer never has to fetch a fallback font or emoji glyph.

import {
  addDays,
  buildDayDetail,
  formatDayLong,
  formatHm,
  type DayCycleInput,
  type DayDetail,
  type DayRecoveryInput,
  type DaySleepInput,
  type DayWorkoutInput,
} from "@/lib/analytics/dayDetail";

export type ShareTheme = "dark" | "light";
export type ShareTone = "green" | "yellow" | "red" | "neutral";
export type ShareTileKey = "recovery" | "sleep" | "strain" | "hrv" | "rhr";

export type ShareOptions = { hideNumbers: boolean; theme: ShareTheme };

export type ShareTile = {
  key: ShareTileKey;
  label: string;
  /** The headline number ("68%", "7h 42m"). Always null in hide-numbers mode. */
  value: string | null;
  /** Qualitative band ("Green", "Optimal", "Above usual"), when one applies. */
  band: string | null;
  tone: ShareTone;
  /** A secondary line ("92% performance"). Null in hide-numbers mode. */
  detail: string | null;
  /** No data for this section on the card's day. */
  missing: boolean;
};

export type SharePalette = {
  background: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  tones: Record<ShareTone, string>;
};

export type TodayCardModel = {
  /** The day the card shows (YYYY-MM-DD). */
  date: string;
  /** "Today" or "Yesterday" — yesterday only when today has nothing yet. */
  dayLabel: string;
  /** "Friday, Nov 27, 2026". */
  dateLabel: string;
  isToday: boolean;
  hasAnyData: boolean;
  hideNumbers: boolean;
  theme: ShareTheme;
  palette: SharePalette;
  /** Fixed order: recovery, sleep, strain, hrv, rhr. */
  tiles: ShareTile[];
  recap: string;
};

export type TodayCardInput = {
  /** The user's calendar today (YYYY-MM-DD, in their tz). */
  today: string;
  tz: string;
  /** Rows over a window ending on `today`; this module picks by date. Recovery
   *  rows should reach `BASELINE_DAYS` before yesterday for the HRV/RHR
   *  "usual" comparison. Other rows only need today and yesterday. */
  recovery: DayRecoveryInput[];
  sleep: DaySleepInput[];
  cycles: DayCycleInput[];
  workouts: DayWorkoutInput[];
} & ShareOptions;

/** Days before the card's day that form the HRV / RHR "usual" baseline. */
export const BASELINE_DAYS = 30;
/** Fewer prior readings than this and there is no baseline band. */
export const BASELINE_MIN_DAYS = 7;
/** Within ±this fraction of the baseline median reads as "Usual". */
export const BASELINE_TOLERANCE = 0.05;

export const PALETTES: Record<ShareTheme, SharePalette> = {
  dark: {
    background: "#0e0e10",
    surface: "#1a1a1d",
    border: "#2c2c31",
    text: "#f3f3f1",
    muted: "#9c9c98",
    // The same band colours the Day detail page uses (day.module.css).
    tones: { green: "#16ec06", yellow: "#ffde00", red: "#ff0026", neutral: "#9c9c98" },
  },
  light: {
    background: "#f5f4f0",
    surface: "#ffffff",
    border: "#e0ded8",
    text: "#151515",
    muted: "#5c5c58",
    // Darkened band colours so text on white stays at or above 4.5:1.
    tones: { green: "#1a7a10", yellow: "#8a6a00", red: "#c4001d", neutral: "#5c5c58" },
  },
};

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

type ParamValue = string | string[] | undefined | null;
const first = (v: ParamValue): string | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));

/** `?hide=1` hides numbers; `?theme=light` picks light. Anything else → defaults. */
export function parseShareOptions(params: { hide?: ParamValue; theme?: ParamValue }): ShareOptions {
  return {
    hideNumbers: first(params.hide) === "1",
    theme: first(params.theme) === "light" ? "light" : "dark",
  };
}

/** Query string for a set of options, omitting defaults ("" when both are). */
export function shareQuery(o: ShareOptions): string {
  const q = new URLSearchParams();
  if (o.hideNumbers) q.set("hide", "1");
  if (o.theme === "light") q.set("theme", "light");
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Download filename. Date only — nothing that identifies the user. */
export function shareFilename(date: string): string {
  return `coach-day-${date}.png`;
}

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

const RECOVERY_BAND_LABEL = { green: "Green", yellow: "Yellow", red: "Red" } as const;

/** Whoop's sleep-performance bands: 85+ optimal, 70–84 sufficient, <70 poor. */
export function sleepBand(performance: number): { band: string; tone: ShareTone } {
  if (performance >= 85) return { band: "Optimal", tone: "green" };
  if (performance >= 70) return { band: "Sufficient", tone: "yellow" };
  return { band: "Poor", tone: "red" };
}

/** Whoop's strain categories: <10 light, 10–13.9 moderate, 14–17.9 high, 18+ all out. */
export function strainBand(strain: number): string {
  if (strain >= 18) return "All out";
  if (strain >= 14) return "High";
  if (strain >= 10) return "Moderate";
  return "Light";
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export type BaselineCompare = "above" | "usual" | "below";

/** Compare `value` to the baseline median; null when there is no baseline. */
export function compareToBaseline(value: number, baseline: number | null): BaselineCompare | null {
  if (baseline === null || baseline <= 0) return null;
  const ratio = value / baseline;
  if (ratio > 1 + BASELINE_TOLERANCE) return "above";
  if (ratio < 1 - BASELINE_TOLERANCE) return "below";
  return "usual";
}

const COMPARE_LABEL: Record<BaselineCompare, string> = {
  above: "Above usual",
  usual: "Usual",
  below: "Below usual",
};

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

function hasRowFor(input: TodayCardInput, date: string): boolean {
  return (
    input.recovery.some((r) => r.date === date) ||
    input.sleep.some((r) => r.date === date) ||
    input.cycles.some((r) => r.date === date) ||
    input.workouts.some((r) => r.date === date)
  );
}

function dayFor(input: TodayCardInput, date: string): DayDetail {
  return buildDayDetail({
    date,
    today: input.today,
    tz: input.tz,
    recovery: input.recovery.find((r) => r.date === date) ?? null,
    sleep: input.sleep.find((r) => r.date === date) ?? null,
    cycle: input.cycles.find((r) => r.date === date) ?? null,
    workouts: input.workouts.filter((w) => w.date === date),
    // Naps, journal and the day picker are not on the card; passing nothing
    // keeps journal text out of the model entirely.
    naps: [],
    journal: [],
    datesWithData: [],
  });
}

function missingTile(key: ShareTileKey, label: string, isToday: boolean): ShareTile {
  return {
    key,
    label,
    value: null,
    band: isToday ? "Not synced yet" : "No data",
    tone: "neutral",
    detail: null,
    missing: true,
  };
}

function baselineTile(
  key: "hrv" | "rhr",
  label: string,
  value: number | null,
  baseline: number | null,
  unit: string,
  higherIsBetter: boolean,
  hide: boolean,
  isToday: boolean,
): ShareTile {
  if (!finite(value)) return missingTile(key, label, isToday);
  const cmp = compareToBaseline(value, baseline);
  const tone: ShareTone =
    cmp === null || cmp === "usual" ? "neutral" : (cmp === "above") === higherIsBetter ? "green" : "yellow";
  return {
    key,
    label,
    value: hide ? null : `${Math.round(value)} ${unit}`,
    // With no baseline there is nothing to band against; hide mode still says
    // the reading exists rather than pretending it is missing.
    band: cmp ? COMPARE_LABEL[cmp] : hide ? "Recorded" : null,
    tone,
    detail: hide || baseline === null || cmp === null ? null : `30-day usual ${Math.round(baseline)} ${unit}`,
    missing: false,
  };
}

/** Sleep performance, or asleep/need as a fallback when Whoop gave no score. */
function sleepPerformance(s: NonNullable<DayDetail["sleep"]>): number | null {
  if (finite(s.performance)) return s.performance;
  if (finite(s.asleepMs) && finite(s.needMs) && s.needMs > 0) return (s.asleepMs / s.needMs) * 100;
  return null;
}

export function buildRecapLine(
  tiles: ShareTile[],
  opts: { hideNumbers: boolean; isToday: boolean; hasAnyData: boolean; workoutCount: number },
): string {
  if (!opts.hasAnyData) return opts.isToday ? "Nothing has synced for today yet." : "No data was recorded for this day.";
  const t = Object.fromEntries(tiles.map((x) => [x.key, x])) as Record<ShareTileKey, ShareTile>;
  const clauses: string[] = [];
  const rec = t.recovery;
  if (!rec.missing && rec.band) {
    clauses.push(opts.hideNumbers || !rec.value ? `${rec.band.toLowerCase()} recovery` : `${rec.band.toLowerCase()} recovery at ${rec.value}`);
  }
  const sl = t.sleep;
  if (!sl.missing) {
    if (!opts.hideNumbers && sl.value) clauses.push(`${sl.value} asleep`);
    else if (sl.band) clauses.push(`${sl.band.toLowerCase()} sleep`);
  }
  // A count, never a sport name: sport is free text from the database.
  // Hide mode drops the digit too, so the card shows no numbers at all
  // beyond its date.
  const workouts =
    opts.workoutCount === 0
      ? null
      : opts.hideNumbers
        ? opts.workoutCount === 1 ? "a workout" : "workouts"
        : opts.workoutCount === 1 ? "1 workout" : `${opts.workoutCount} workouts`;
  const st = t.strain;
  if (!st.missing) {
    const soFar = opts.isToday ? " so far" : "";
    const strain =
      opts.hideNumbers || !st.value ? `${(st.band ?? "some").toLowerCase()} strain${soFar}` : `strain ${st.value}${soFar}`;
    clauses.push(workouts ? `${strain} with ${workouts}` : strain);
  } else if (workouts) {
    clauses.push(workouts);
  }
  if (clauses.length === 0) return "Some data was recorded, but no headline metrics.";
  const body = clauses.join(", ");
  return `${body[0].toUpperCase()}${body.slice(1)}.`;
}

export function buildTodayCard(input: TodayCardInput): TodayCardModel {
  const { today, hideNumbers: hide, theme } = input;
  const yesterday = addDays(today, -1);
  // Early in the morning today may have nothing yet; show yesterday then,
  // labelled as such, instead of an empty card.
  const date = !hasRowFor(input, today) && hasRowFor(input, yesterday) ? yesterday : today;
  const isToday = date === today;
  const day = dayFor(input, date);

  const tiles: ShareTile[] = [];

  // Recovery
  const score = day.recovery?.score;
  if (finite(score) && day.recovery?.band) {
    const band = day.recovery.band;
    tiles.push({
      key: "recovery",
      label: "Recovery",
      value: hide ? null : `${Math.round(score)}%`,
      band: RECOVERY_BAND_LABEL[band],
      tone: band,
      detail: null,
      missing: false,
    });
  } else {
    tiles.push(missingTile("recovery", "Recovery", isToday));
  }

  // Sleep
  const s = day.sleep;
  if (s && (finite(s.asleepMs) || finite(s.performance))) {
    const perf = sleepPerformance(s);
    const b = perf === null ? null : sleepBand(perf);
    tiles.push({
      key: "sleep",
      label: "Sleep",
      value: hide ? null : finite(s.asleepMs) ? formatHm(s.asleepMs) : `${Math.round(perf as number)}%`,
      band: b ? b.band : hide ? "Recorded" : null,
      tone: b ? b.tone : "neutral",
      detail:
        hide || !finite(s.performance) || !finite(s.asleepMs) ? null : `${Math.round(s.performance)}% performance`,
      missing: false,
    });
  } else {
    tiles.push(missingTile("sleep", "Sleep", isToday));
  }

  // Strain
  const strain = day.strain?.strain;
  const workoutCount = day.workouts.length;
  if (finite(strain)) {
    tiles.push({
      key: "strain",
      label: isToday ? "Strain so far" : "Strain",
      value: hide ? null : strain.toFixed(1),
      band: strainBand(strain),
      tone: "neutral",
      detail: hide ? null : workoutCount === 0 ? "No workouts" : workoutCount === 1 ? "1 workout" : `${workoutCount} workouts`,
      missing: false,
    });
  } else {
    tiles.push(missingTile("strain", isToday ? "Strain so far" : "Strain", isToday));
  }

  // HRV / RHR vs the user's own prior 30 days (strictly before `date`).
  const windowStart = addDays(date, -BASELINE_DAYS);
  const prior = input.recovery.filter((r) => r.date >= windowStart && r.date < date);
  const baselineOf = (vals: Array<number | null>): number | null => {
    const v = vals.filter(finite);
    return v.length >= BASELINE_MIN_DAYS ? median(v) : null;
  };
  tiles.push(
    baselineTile("hrv", "HRV", day.recovery?.hrv ?? null, baselineOf(prior.map((r) => r.hrv)), "ms", true, hide, isToday),
  );
  tiles.push(
    baselineTile("rhr", "Resting HR", day.recovery?.rhr ?? null, baselineOf(prior.map((r) => r.rhr)), "bpm", false, hide, isToday),
  );

  const hasAnyData = tiles.some((t) => !t.missing) || workoutCount > 0;
  return {
    date,
    dayLabel: isToday ? "Today" : "Yesterday",
    dateLabel: formatDayLong(date),
    isToday,
    hasAnyData,
    hideNumbers: hide,
    theme,
    palette: PALETTES[theme],
    tiles,
    recap: buildRecapLine(tiles, { hideNumbers: hide, isToday, hasAnyData, workoutCount }),
  };
}
