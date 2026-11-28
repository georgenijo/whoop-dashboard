// ---------------------------------------------------------------------------
// Workout calendar (WORKOUT_CALENDAR=1)
//
// Builds a Monday-first month grid of the user's workouts plus the month
// summary shown above it. Pure: no DB, network, clock or locale-default access.
// Callers pass `today` (the user's local date) and the user's IANA `tz`.
//
// Day bucketing: a workout belongs to the local calendar day it STARTED on in
// the user's zone (from `start_utc`), so a 23:30 → 00:40 session counts on the
// start day, and the minutes are not split across midnight. When `start_utc`
// is missing or unparsable the row's stored `date` (already start-day local,
// see `upsertWorkout`) is used. All grid arithmetic runs on YYYY-MM-DD strings
// through UTC midnights, so DST transitions never add or drop a day.
// ---------------------------------------------------------------------------

export type CalendarWorkoutInput = {
  id: string;
  date: string;
  sport: string | null;
  duration_sec: number | null;
  strain: number | null;
  start_utc: string | null;
};

export type CalendarWorkout = {
  id: string;
  sport: string;
  minutes: number;
  strain: number | null;
  /** Local start time "HH:MM" in the user's zone, or null when unknown. */
  startTime: string | null;
};

export type StrainBand = "light" | "moderate" | "high" | "allout";

export type CalendarDay = {
  date: string;
  dayOfMonth: number;
  /** False for the leading/trailing days that pad the grid to whole weeks. */
  inMonth: boolean;
  /** True for in-month days after `today` (no data yet, not rest days). */
  future: boolean;
  isToday: boolean;
  workouts: CalendarWorkout[];
  totalMinutes: number;
  /** Highest single-session strain that day (Whoop strain is not additive). */
  peakStrain: number | null;
  band: StrainBand | null;
  /** Distinct sports in order of first session that day. */
  sports: string[];
  /** Full text for aria-label/title, e.g. "Tue, Nov 4: 2 workouts, 75 min (Running, Cycling), peak strain 14.2 (high)". */
  label: string;
};

export type BusiestDay = { date: string; minutes: number; sessions: number };

export type MonthSummary = {
  sessions: number;
  hours: number;
  /** Mean strain across sessions with a strain value; null when none. */
  avgStrain: number | null;
  busiestDay: BusiestDay | null;
  trainingDays: number;
  /** In-month days up to today with no workout. */
  restDays: number;
  /** Longest run of consecutive training days inside the month. */
  longestStreak: number;
  /** Longest run of consecutive rest days inside the month (up to today). */
  longestRestGap: number;
  /** Days counted (whole month for past months, 1..today for the current one). */
  elapsedDays: number;
};

export type WorkoutCalendarMonth = {
  /** YYYY-MM */
  month: string;
  /** e.g. "November 2026" */
  title: string;
  prevMonth: string | null;
  nextMonth: string | null;
  /** Grid bounds (inclusive), Monday of week 1 through Sunday of the last week. */
  gridStart: string;
  gridEnd: string;
  weeks: CalendarDay[][];
  summary: MonthSummary;
};

/** Earliest month the page accepts (Whoop data predates nothing earlier). */
export const MIN_MONTH = "2012-01";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 86_400_000;

function toMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function shiftDays(date: string, days: number): string {
  return fromMs(toMs(date) + days * DAY_MS);
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}

/**
 * Validate `?month=YYYY-MM`: must be a real month between MIN_MONTH and the
 * month containing `today`. Anything else (missing, malformed, "2026-13",
 * a future month) falls back to today's month.
 */
export function parseCalendarMonth(raw: string | string[] | undefined, today: string): string {
  const current = today.slice(0, 7);
  if (typeof raw !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return current;
  if (raw < MIN_MONTH || raw > current) return current;
  return raw;
}

/** Inclusive date bounds of the Monday-first grid for a month. */
export function monthGridBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const last = `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
  const firstDow = new Date(toMs(first)).getUTCDay(); // 0 = Sun
  const lead = (firstDow + 6) % 7; // days back to Monday
  const lastDow = new Date(toMs(last)).getUTCDay();
  const trail = (7 - lastDow) % 7; // days forward to Sunday
  return { start: shiftDays(first, -lead), end: shiftDays(last, trail) };
}

/**
 * Date range to read from the DB for a month: the grid bounds padded by one
 * day each side, because the stored `date` and the tz re-bucketing below can
 * differ by at most a day at the edges (e.g. the user changed zone).
 */
export function monthQueryBounds(month: string): { start: string; end: string } {
  const g = monthGridBounds(month);
  return { start: shiftDays(g.start, -1), end: shiftDays(g.end, 1) };
}

function localParts(iso: string, tz: string): { date: string; time: string } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return null;
  }
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function safeTz(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Whoop strain bands: light < 10, moderate 10–14, high 14–18, all out ≥ 18. */
export function strainBand(strain: number | null): StrainBand | null {
  if (strain == null || !Number.isFinite(strain)) return null;
  if (strain >= 18) return "allout";
  if (strain >= 14) return "high";
  if (strain >= 10) return "moderate";
  return "light";
}

export const BAND_LABEL: Record<StrainBand, string> = {
  light: "light",
  moderate: "moderate",
  high: "high",
  allout: "all out",
};

function minutesOf(sec: number | null): number {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return 0;
  return Math.round(sec / 60);
}

function dayLabel(date: string): string {
  const d = new Date(toMs(date));
  return `${DAY_NAMES[d.getUTCDay()]}, ${MONTH_NAMES[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`;
}

function describeDay(day: Omit<CalendarDay, "label">): string {
  const head = dayLabel(day.date);
  if (day.future) return `${head}: upcoming`;
  if (day.workouts.length === 0) return `${head}: rest day`;
  const n = day.workouts.length;
  let s = `${head}: ${n} workout${n === 1 ? "" : "s"}, ${day.totalMinutes} min (${day.sports.join(", ")})`;
  if (day.peakStrain != null && day.band) {
    s += `, peak strain ${day.peakStrain.toFixed(1)} (${BAND_LABEL[day.band]})`;
  }
  return s;
}

export function buildWorkoutCalendar(
  rows: readonly CalendarWorkoutInput[],
  month: string,
  today: string,
  tz: string | null | undefined,
): WorkoutCalendarMonth {
  const zone = safeTz(tz);
  const { start, end } = monthGridBounds(month);

  // Bucket by local start day; drop duplicates by id defensively.
  const byDate = new Map<string, CalendarWorkout[]>();
  const seen = new Set<string>();
  const sortKey = new Map<CalendarWorkout, string>();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const local = r.start_utc ? localParts(r.start_utc, zone) : null;
    const date = local?.date ?? r.date;
    if (!date || date < start || date > end) continue;
    const w: CalendarWorkout = {
      id: r.id,
      sport: r.sport?.trim() || "Unknown",
      minutes: minutesOf(r.duration_sec),
      strain: r.strain != null && Number.isFinite(r.strain) ? r.strain : null,
      startTime: local?.time ?? null,
    };
    sortKey.set(w, r.start_utc ?? "");
    const list = byDate.get(date);
    if (list) list.push(w);
    else byDate.set(date, [w]);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => (sortKey.get(a)! < sortKey.get(b)! ? -1 : sortKey.get(a)! > sortKey.get(b)! ? 1 : 0));
  }

  const weeks: CalendarDay[][] = [];
  const startMs = toMs(start);
  const total = Math.round((toMs(end) - startMs) / DAY_MS) + 1;
  for (let i = 0; i < total; i++) {
    const date = fromMs(startMs + i * DAY_MS);
    const workouts = byDate.get(date) ?? [];
    const strains = workouts.map((w) => w.strain).filter((s): s is number => s != null);
    const peakStrain = strains.length ? Math.max(...strains) : null;
    const sports: string[] = [];
    for (const w of workouts) if (!sports.includes(w.sport)) sports.push(w.sport);
    const base = {
      date,
      dayOfMonth: Number(date.slice(8, 10)),
      inMonth: date.slice(0, 7) === month,
      future: date > today,
      isToday: date === today,
      workouts,
      totalMinutes: workouts.reduce((a, w) => a + w.minutes, 0),
      peakStrain,
      band: strainBand(peakStrain),
      sports,
    };
    const day: CalendarDay = { ...base, label: describeDay(base) };
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push(day);
  }

  const counted = weeks.flat().filter((d) => d.inMonth && !d.future);
  let sessions = 0;
  let minutes = 0;
  let strainSum = 0;
  let strainN = 0;
  let busiest: BusiestDay | null = null;
  let trainingDays = 0;
  let streak = 0;
  let longestStreak = 0;
  let gap = 0;
  let longestRestGap = 0;
  for (const d of counted) {
    sessions += d.workouts.length;
    minutes += d.totalMinutes;
    for (const w of d.workouts) {
      if (w.strain != null) {
        strainSum += w.strain;
        strainN++;
      }
    }
    if (d.workouts.length > 0) {
      trainingDays++;
      streak++;
      gap = 0;
      if (
        !busiest ||
        d.totalMinutes > busiest.minutes ||
        (d.totalMinutes === busiest.minutes && d.workouts.length > busiest.sessions)
      ) {
        busiest = { date: d.date, minutes: d.totalMinutes, sessions: d.workouts.length };
      }
    } else {
      gap++;
      streak = 0;
    }
    longestStreak = Math.max(longestStreak, streak);
    longestRestGap = Math.max(longestRestGap, gap);
  }

  const [y, m] = month.split("-").map(Number);
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  return {
    month,
    title: `${MONTH_NAMES[m - 1]} ${y}`,
    prevMonth: prev >= MIN_MONTH ? prev : null,
    nextMonth: next <= today.slice(0, 7) ? next : null,
    gridStart: start,
    gridEnd: end,
    weeks,
    summary: {
      sessions,
      hours: Math.round((minutes / 60) * 10) / 10,
      avgStrain: strainN ? Math.round((strainSum / strainN) * 10) / 10 : null,
      busiestDay: busiest,
      trainingDays,
      restDays: counted.length - trainingDays,
      longestStreak,
      longestRestGap,
      elapsedDays: counted.length,
    },
  };
}

/** Short human date for the busiest-day stat, e.g. "Tue, Nov 4". */
export function shortDayLabel(date: string): string {
  return dayLabel(date);
}
