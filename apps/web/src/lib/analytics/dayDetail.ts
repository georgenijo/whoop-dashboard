// Pure assembly of the Day detail page model (`/day/[date]`, DAY_DETAIL=1).
//
// No DB, no network, no clock: every input (rows, `today`, the user's IANA
// tz) is passed in, so the same inputs always give the same page. Date math
// is done on calendar dates via Date.UTC, never on local wall-clock
// instants, so a DST transition can't make "previous day" skip or repeat.

/** Structural copies of the reader row shapes this model consumes. Kept
 *  local (not imported from `@/lib/db`, which is server-only) so this
 *  module stays importable from plain unit tests. */
export type DayRecoveryInput = {
  date: string;
  recovery_score: number | null;
  hrv: number | null;
  rhr: number | null;
  spo2: number | null;
  skin_temp: number | null;
};

export type DaySleepInput = {
  date: string;
  in_bed_ms: number | null;
  light_ms: number | null;
  deep_ms: number | null;
  rem_ms: number | null;
  awake_ms: number | null;
  sleep_need_ms: number | null;
  performance: number | null;
  efficiency: number | null;
  consistency: number | null;
  disturbances: number | null;
  respiratory_rate: number | null;
  start_local: string | null;
  end_local: string | null;
};

export type DayNapInput = { date: string; duration_ms: number | null };

export type DayCycleInput = {
  date: string;
  strain: number | null;
  kilojoule: number | null;
  avg_hr: number | null;
  max_hr: number | null;
};

export type DayWorkoutInput = {
  id: string;
  date: string;
  sport: string | null;
  duration_sec: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  strain: number | null;
  kilojoule: number | null;
  distance_m: number | null;
  start_utc: string | null;
};

export type DayJournalInput = {
  date: string;
  title: string | null;
  content: string | null;
  mood: string | null;
  tags: string | null;
};

// ---------------------------------------------------------------------------
// Calendar-date helpers
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Strictly parse a `YYYY-MM-DD` route segment. Returns the date unchanged
 * when it is a real calendar date (no Feb 30, no month 13, no padding
 * tricks), else null. Does not check "not in the future" — that needs the
 * user's `today`; see `validateDayParam`.
 */
export function parseDayParam(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = DATE_RE.exec(raw);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || mo < 1 || mo > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Date.UTC normalises overflow (Feb 30 → Mar 2); a round trip catches it.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return raw;
}

export type DayParamResult =
  | { ok: true; date: string }
  | { ok: false; reason: "invalid" | "future" };

/** Full route validation: real calendar date AND not after `today`. */
export function validateDayParam(raw: unknown, today: string): DayParamResult {
  const date = parseDayParam(raw);
  if (!date) return { ok: false, reason: "invalid" };
  if (date > today) return { ok: false, reason: "future" };
  return { ok: true, date };
}

/** Shift a `YYYY-MM-DD` by whole calendar days (DST-proof: pure UTC math). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** The calendar date in `tz` at instant `now`. Unknown tz → UTC. */
export function todayInTz(now: Date, tz: string): string {
  const fmt = (zone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  try {
    return fmt(tz);
  } catch {
    return fmt("UTC");
  }
}

/** "Saturday, Nov 28, 2026" — formatted in UTC so the day never shifts. */
export function formatDayLong(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Nov 28, 2026" — short label for picker options and nav buttons. */
export function formatDayShort(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Milliseconds → "7h 05m" / "42m". */
export function formatHm(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** "23:11:00"-style naive local ISO → "11:11 PM". Already local to the
 *  record's own offset at sync time, so no tz conversion is applied. */
export function clockFromLocalIso(localIso: string | null): string | null {
  if (!localIso) return null;
  const m = /T(\d{2}):(\d{2})/.exec(localIso);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2];
  if (h > 23) return null;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min} ${h < 12 ? "AM" : "PM"}`;
}

/** UTC instant → "6:42 AM" in `tz` (DST handled by Intl). Bad input → null. */
export function clockInTz(utcIso: string | null, tz: string): string | null {
  if (!utcIso) return null;
  const t = new Date(utcIso);
  if (Number.isNaN(t.getTime())) return null;
  const fmt = (zone: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(t);
  try {
    return fmt(tz);
  } catch {
    return fmt("UTC");
  }
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type RecoveryBand = "green" | "yellow" | "red";

/** Whoop's own bands: 67–100 green, 34–66 yellow, 0–33 red. */
export function recoveryBand(score: number): RecoveryBand {
  if (score >= 67) return "green";
  if (score >= 34) return "yellow";
  return "red";
}

export type DayStage = { key: "deep" | "rem" | "light" | "awake"; label: string; ms: number; pct: number };

export type DayDetail = {
  date: string;
  today: string;
  isToday: boolean;
  prevDate: string;
  /** null when `date` is today — the next day is in the future. */
  nextDate: string | null;
  /** Nearest earlier / later day that has synced data (null if none). */
  prevWithData: string | null;
  nextWithData: string | null;
  hasAnyData: boolean;
  recovery: {
    score: number | null;
    band: RecoveryBand | null;
    hrv: number | null;
    rhr: number | null;
    spo2: number | null;
    skinTemp: number | null;
    respiratoryRate: number | null;
  } | null;
  sleep: {
    asleepMs: number | null;
    inBedMs: number | null;
    needMs: number | null;
    performance: number | null;
    efficiency: number | null;
    consistency: number | null;
    disturbances: number | null;
    bedtime: string | null;
    wake: string | null;
    stages: DayStage[];
  } | null;
  naps: { count: number; totalMs: number };
  strain: {
    strain: number | null;
    kcal: number | null;
    avgHr: number | null;
    maxHr: number | null;
  } | null;
  workouts: Array<{
    id: string;
    sport: string;
    startTime: string | null;
    durationSec: number | null;
    strain: number | null;
    avgHr: number | null;
    maxHr: number | null;
    kcal: number | null;
    distanceKm: number | null;
  }>;
  journal: Array<{ title: string | null; content: string | null; mood: string | null; tags: string[] }>;
  recap: string;
  /** Days with data for the picker, newest first, never after `today`. */
  pickerDates: string[];
};

export type DayDetailInput = {
  date: string;
  today: string;
  tz: string;
  recovery: DayRecoveryInput | null;
  sleep: DaySleepInput | null;
  naps: DayNapInput[];
  cycle: DayCycleInput | null;
  workouts: DayWorkoutInput[];
  journal: DayJournalInput[];
  /** Every date the user has data on, any order, duplicates allowed. */
  datesWithData: string[];
};

/** Picker cap — a year of options keeps the page small; older days stay
 *  reachable via the prev/next buttons or the URL. */
export const PICKER_MAX_DATES = 365;

const KJ_TO_KCAL = 0.239006;

const num = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function allNull(values: Array<number | null>): boolean {
  return values.every((v) => v === null);
}

function buildRecovery(r: DayRecoveryInput | null, s: DaySleepInput | null): DayDetail["recovery"] {
  const score = num(r?.recovery_score);
  const out = {
    score,
    band: score === null ? null : recoveryBand(score),
    hrv: num(r?.hrv),
    rhr: num(r?.rhr),
    spo2: num(r?.spo2),
    skinTemp: num(r?.skin_temp),
    // Respiratory rate is a sleep metric in Whoop's model but reads as a
    // recovery vital; it rides along from the night that produced it.
    respiratoryRate: num(s?.respiratory_rate),
  };
  return allNull([out.score, out.hrv, out.rhr, out.spo2, out.skinTemp, out.respiratoryRate])
    ? null
    : out;
}

function buildSleep(s: DaySleepInput | null): DayDetail["sleep"] {
  if (!s) return null;
  const light = num(s.light_ms);
  const deep = num(s.deep_ms);
  const rem = num(s.rem_ms);
  const awake = num(s.awake_ms);
  const asleepParts = [light, deep, rem].filter((v): v is number => v !== null);
  const asleepMs = asleepParts.length ? asleepParts.reduce((a, b) => a + b, 0) : null;
  const stageTotal = (asleepMs ?? 0) + (awake ?? 0);
  const stages: DayStage[] =
    stageTotal > 0
      ? (
          [
            ["deep", "Deep", deep],
            ["rem", "REM", rem],
            ["light", "Light", light],
            ["awake", "Awake", awake],
          ] as const
        )
          .filter(([, , ms]) => ms !== null && ms > 0)
          .map(([key, label, ms]) => ({ key, label, ms: ms as number, pct: ((ms as number) / stageTotal) * 100 }))
      : [];
  const out = {
    asleepMs,
    inBedMs: num(s.in_bed_ms),
    needMs: num(s.sleep_need_ms),
    performance: num(s.performance),
    efficiency: num(s.efficiency),
    consistency: num(s.consistency),
    disturbances: num(s.disturbances),
    bedtime: clockFromLocalIso(s.start_local),
    wake: clockFromLocalIso(s.end_local),
    stages,
  };
  return allNull([out.asleepMs, out.inBedMs, out.performance, out.efficiency]) && !out.bedtime
    ? null
    : out;
}

function buildStrain(c: DayCycleInput | null): DayDetail["strain"] {
  if (!c) return null;
  const kj = num(c.kilojoule);
  const out = {
    strain: num(c.strain),
    kcal: kj === null ? null : Math.round(kj * KJ_TO_KCAL),
    avgHr: num(c.avg_hr),
    maxHr: num(c.max_hr),
  };
  return allNull([out.strain, out.kcal, out.avgHr, out.maxHr]) ? null : out;
}

function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  const trimmed = tags.trim();
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) return arr.map(String).map((t) => t.trim()).filter(Boolean);
    } catch {
      // fall through to comma split
    }
  }
  return trimmed.split(",").map((t) => t.trim()).filter(Boolean);
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** One plain-language line. Only states what the data says — no advice. */
export function buildRecap(d: Pick<DayDetail, "recovery" | "sleep" | "strain" | "workouts" | "journal" | "naps" | "isToday" | "hasAnyData">): string {
  if (!d.hasAnyData) {
    return d.isToday ? "Nothing has synced for today yet." : "No data was recorded for this day.";
  }
  const clauses: string[] = [];
  if (d.recovery?.score != null && d.recovery.band) {
    clauses.push(`${d.recovery.band} recovery at ${Math.round(d.recovery.score)}%`);
  } else if (d.recovery?.hrv != null) {
    clauses.push(`HRV ${Math.round(d.recovery.hrv)} ms`);
  }
  if (d.sleep?.asleepMs != null) {
    const perf = d.sleep.performance != null ? ` (${Math.round(d.sleep.performance)}% sleep performance)` : "";
    clauses.push(`${formatHm(d.sleep.asleepMs)} asleep${perf}`);
  }
  if (d.naps.count > 0) {
    clauses.push(`${d.naps.count === 1 ? "a nap" : `${d.naps.count} naps`} (${formatHm(d.naps.totalMs)})`);
  }
  if (d.strain?.strain != null) {
    clauses.push(`day strain ${d.strain.strain.toFixed(1)}`);
  }
  if (d.workouts.length > 0) {
    const sports = [...new Set(d.workouts.map((w) => w.sport))];
    const n = d.workouts.length;
    clauses.push(`${n === 1 ? "1 workout" : `${n} workouts`} (${listJoin(sports)})`);
  } else if (d.strain?.strain != null) {
    clauses.push("no workouts");
  }
  if (d.journal.length > 0) {
    clauses.push(d.journal.length === 1 ? "1 journal entry" : `${d.journal.length} journal entries`);
  }
  if (clauses.length === 0) return "Some data was recorded, but no headline metrics.";
  const body = clauses.join(", ");
  const sentence = body[0].toUpperCase() + body.slice(1);
  return d.isToday ? `So far today: ${body}.` : `${sentence}.`;
}

export function buildDayDetail(input: DayDetailInput): DayDetail {
  const { date, today, tz } = input;
  const isToday = date === today;

  const recovery = buildRecovery(input.recovery, input.sleep);
  const sleep = buildSleep(input.sleep);
  const strain = buildStrain(input.cycle);
  const napMs = input.naps.map((n) => num(n.duration_ms) ?? 0);
  const naps = { count: input.naps.length, totalMs: napMs.reduce((a, b) => a + b, 0) };

  const workouts = [...input.workouts]
    .sort((a, b) => (a.start_utc ?? "").localeCompare(b.start_utc ?? "") || a.id.localeCompare(b.id))
    .map((w) => {
      const kj = num(w.kilojoule);
      const dist = num(w.distance_m);
      return {
        id: w.id,
        sport: w.sport?.trim() || "Workout",
        startTime: clockInTz(w.start_utc, tz),
        durationSec: num(w.duration_sec),
        strain: num(w.strain),
        avgHr: num(w.avg_hr),
        maxHr: num(w.max_hr),
        kcal: kj === null ? null : Math.round(kj * KJ_TO_KCAL),
        distanceKm: dist === null || dist <= 0 ? null : dist / 1000,
      };
    });

  const journal = input.journal
    .filter((j) => j.title?.trim() || j.content?.trim() || j.mood?.trim() || j.tags?.trim())
    .map((j) => ({
      title: j.title?.trim() || null,
      content: j.content?.trim() || null,
      mood: j.mood?.trim() || null,
      tags: parseTags(j.tags),
    }));

  const hasAnyData =
    recovery !== null || sleep !== null || strain !== null || naps.count > 0 || workouts.length > 0 || journal.length > 0;

  const known = [...new Set(input.datesWithData.filter((d) => parseDayParam(d) && d <= today))];
  if (hasAnyData && !known.includes(date)) known.push(date);
  known.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  let prevWithData: string | null = null;
  let nextWithData: string | null = null;
  for (const d of known) {
    if (d < date) {
      prevWithData = d;
      break;
    }
    if (d > date) nextWithData = d;
  }

  const pickerDates = known.slice(0, PICKER_MAX_DATES);
  // An older day past the cap still shows as the selected option.
  if (hasAnyData && !pickerDates.includes(date)) pickerDates.push(date);

  const base = { recovery, sleep, strain, naps, workouts, journal, isToday, hasAnyData };
  return {
    date,
    today,
    prevDate: addDays(date, -1),
    nextDate: date >= today ? null : addDays(date, 1),
    prevWithData,
    nextWithData,
    ...base,
    recap: buildRecap(base),
    pickerDates,
  };
}
