import { computeIllnessSignal } from "@/lib/analytics/illness";
import { computeOTS } from "@/lib/analytics/ots";
import { recoveryZone, type Zone } from "@/lib/format";
import type { CycleRow, RecoveryRow, SleepRow, WorkoutRow } from "@/lib/db";

/**
 * Overview "Today" brief: 4–6 short lines that summarize this morning from
 * data the dashboard already has. This module is pure — no DB, no clock, no
 * network — so every rule is unit-testable. The caller
 * (`readOverviewMorningBriefInputs` in `lib/db/morning-brief.ts`) supplies
 * user-scoped rows and the user's local `today`.
 *
 * All date math works on `YYYY-MM-DD` strings in UTC, so a DST change in the
 * user's zone never shifts a day boundary.
 */

export type MorningBriefInput = {
  /** User-local calendar date, `YYYY-MM-DD`. */
  today: string;
  recovery: RecoveryRow[];
  sleep: SleepRow[];
  cycles: CycleRow[];
  workouts: WorkoutRow[];
};

export type BriefTone = "good" | "warn" | "bad" | "neutral";
export type BriefLineKey = "readiness" | "sleep" | "yesterday" | "watch" | "suggestion";

export type BriefLine = {
  key: BriefLineKey;
  label: string;
  text: string;
  tone: BriefTone;
  /** Short qualifier, e.g. "from Wed, Nov 26" when the data is not from today. */
  note: string | null;
};

export type MorningBriefView = {
  today: string;
  /** "empty" = no recovery, sleep, or strain data in the look-back window. */
  status: "ok" | "empty";
  /** Day the brief describes: the latest scored recovery day, else `today`. */
  anchorDate: string;
  /** Newest date across recovery/sleep/cycles; drives the freshness banner. */
  latestDataDate: string | null;
  lines: BriefLine[];
};

/**
 * Server-side flag for the Overview "Today" card. Off unless exactly "1";
 * when off, the page performs no extra reads and renders nothing new.
 */
export function isMorningBriefEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.MORNING_BRIEF === "1";
}

/** Look-back the reader should fetch. Illness needs a 14-day baseline + 7 min periods. */
export const MORNING_BRIEF_LOOKBACK_DAYS = 30;
const AVG_WINDOW_DAYS = 7;
const AVG_MIN_SAMPLES = 3;
const DEFAULT_SLEEP_NEED_H = 7.5;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(date: string): number | null {
  if (!DATE_RE.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

export function shiftDate(date: string, days: number): string {
  const ms = parseDate(date);
  if (ms === null) throw new Error(`Invalid date: ${date}`);
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b − a). Null when either date is malformed. */
export function dayDiff(a: string, b: string): number | null {
  const am = parseDate(a);
  const bm = parseDate(b);
  if (am === null || bm === null) return null;
  return Math.round((bm - am) / 86_400_000);
}

/** "Wed, Nov 26" — formatted in UTC so the server's zone can't move the day. */
export function friendlyDate(date: string): string {
  const ms = parseDate(date);
  if (ms === null) return date;
  return new Date(ms).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "11:42 PM" from a naive local ISO (`2026-11-26T23:42:00`) as stored by sync. */
export function clockTime(localIso: string | null | undefined): string | null {
  if (!localIso) return null;
  const m = /T(\d{2}):(\d{2})/.exec(localIso);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2];
  if (h > 23 || Number(min) > 59) return null;
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min} ${suffix}`;
}

function finite(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function signed(n: number, digits = 0): string {
  const v = digits === 0 ? Math.round(n) : Math.round(n * 10 ** digits) / 10 ** digits;
  if (v === 0) return "±0";
  return v > 0 ? `+${v}` : `−${Math.abs(v)}`;
}

export function sleepHours(row: SleepRow): number | null {
  if (!finite(row.light_ms) || !finite(row.deep_ms) || !finite(row.rem_ms)) return null;
  const h = (row.light_ms + row.deep_ms + row.rem_ms) / 3_600_000;
  return h > 0 && h <= 24 ? h : null;
}

function sportLabel(sport: string | null): string {
  const s = (sport ?? "").trim().replace(/[_-]+/g, " ");
  if (!s) return "Workout";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function zoneName(zone: Zone): string {
  return zone === "green" ? "Green" : zone === "yellow" ? "Yellow" : "Red";
}

function zoneTone(zone: Zone): BriefTone {
  return zone === "green" ? "good" : zone === "yellow" ? "warn" : "bad";
}

function notTodayNote(date: string, anchor: string): string | null {
  return date === anchor ? null : `from ${friendlyDate(date)}`;
}

/** Mean of scored recovery in the 7 days before `date` (exclusive). */
export function priorRecoveryAverage(rows: RecoveryRow[], date: string): number | null {
  const start = shiftDate(date, -AVG_WINDOW_DAYS);
  const vals = rows
    .filter((r) => r.date >= start && r.date < date && finite(r.recovery_score))
    .map((r) => r.recovery_score as number);
  if (vals.length < AVG_MIN_SAMPLES) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

type WatchOut = { kind: "illness" | "overtraining"; text: string };

function watchOut(
  recovery: RecoveryRow[],
  sleep: SleepRow[],
  cycles: CycleRow[],
  anchor: string,
): WatchOut | null {
  const illness = computeIllnessSignal(recovery, sleep).find((r) => r.date === anchor);
  if (illness?.illness_flag) {
    const parts: string[] = [];
    if (illness.rhr_flag && finite(illness.rhr_dev)) parts.push(`RHR ${signed(illness.rhr_dev)} bpm`);
    if (illness.hrv_flag && finite(illness.hrv_dev)) parts.push(`HRV ${signed(illness.hrv_dev)}%`);
    if (illness.skin_temp_flag && finite(illness.skin_temp_dev)) {
      parts.push(`skin temp ${signed(illness.skin_temp_dev, 1)} °C`);
    }
    return {
      kind: "illness",
      text: `Possible illness signal — ${parts.join(", ")} vs your 14-day baseline`,
    };
  }
  const ots = computeOTS(recovery, cycles);
  if (ots && ots.score >= 2) {
    const parts: string[] = [];
    if (ots.signals.hrv) parts.push("HRV trending down");
    if (ots.signals.rhr) parts.push("RHR trending up");
    if (ots.signals.recovery) parts.push("recovery sliding");
    return {
      kind: "overtraining",
      text: `Overtraining signs — ${parts.join(", ")} under sustained strain (last 7 days)`,
    };
  }
  return null;
}

export function composeMorningBrief(input: MorningBriefInput): MorningBriefView {
  const { today } = input;
  if (parseDate(today) === null) throw new Error(`Invalid today: ${today}`);

  // Never let future-dated rows (clock skew, a zone ahead of the server) leak in.
  const upToToday = <T extends { date: string }>(rows: T[]) =>
    rows.filter((r) => parseDate(r.date) !== null && r.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date));
  const recovery = upToToday(input.recovery);
  const sleep = upToToday(input.sleep);
  const cycles = upToToday(input.cycles);
  const workouts = upToToday(input.workouts);

  const latestDataDate =
    [recovery, sleep, cycles]
      .map((rows) => rows[rows.length - 1]?.date ?? null)
      .filter((d): d is string => d !== null)
      .sort()
      .pop() ?? null;

  const scored = recovery.filter((r) => finite(r.recovery_score));
  const latest = scored[scored.length - 1] ?? null;
  const anchor = latest?.date ?? today;

  if (latestDataDate === null) {
    return {
      today,
      status: "empty",
      anchorDate: today,
      latestDataDate: null,
      lines: [
        {
          key: "suggestion",
          label: "Next",
          text: "No scored data yet — wear your strap tonight and your first brief appears after Whoop scores the night.",
          tone: "neutral",
          note: null,
        },
      ],
    };
  }

  const lines: BriefLine[] = [];

  // 1. Readiness
  let zone: Zone | null = null;
  if (latest) {
    const score = latest.recovery_score as number;
    zone = recoveryZone(score);
    const avg = priorRecoveryAverage(scored, latest.date);
    const parts = [`${Math.round(score)}% · ${zoneName(zone)}`];
    if (avg !== null) parts.push(`${signed(score - avg)} vs 7-day avg ${Math.round(avg)}%`);
    lines.push({
      key: "readiness",
      label: "Readiness",
      text: parts.join(" · "),
      tone: zoneTone(zone),
      note:
        latest.date === today
          ? null
          : `No scored recovery yet today — latest is ${friendlyDate(latest.date)}`,
    });
  } else {
    lines.push({
      key: "readiness",
      label: "Readiness",
      text: "No scored recovery yet",
      tone: "neutral",
      note: null,
    });
  }

  // 2. Last night's sleep — the night that produced the anchor recovery.
  const night =
    sleep.find((s) => s.date === anchor) ??
    [...sleep].reverse().find((s) => s.date <= anchor) ??
    null;
  let hours: number | null = null;
  let needH: number | null = null;
  if (night) {
    hours = sleepHours(night);
    needH = finite(night.sleep_need_ms) && night.sleep_need_ms > 0 ? night.sleep_need_ms / 3_600_000 : null;
    const parts: string[] = [];
    if (hours !== null) {
      parts.push(needH !== null ? `${round1(hours)} h of ${round1(needH)} h need` : `${round1(hours)} h asleep`);
    }
    if (finite(night.performance)) parts.push(`${Math.round(night.performance)}% performance`);
    const bed = clockTime(night.start_local);
    const wake = clockTime(night.end_local);
    if (bed && wake) parts.push(`${bed} → ${wake}`);
    const target = needH ?? DEFAULT_SLEEP_NEED_H;
    const tone: BriefTone =
      hours === null ? "neutral" : hours >= target * 0.9 ? "good" : hours >= target * 0.75 ? "warn" : "bad";
    lines.push({
      key: "sleep",
      label: "Sleep",
      text: parts.length > 0 ? parts.join(" · ") : "Sleep recorded, details pending",
      tone,
      note: notTodayNote(night.date, anchor),
    });
  } else {
    lines.push({ key: "sleep", label: "Sleep", text: "No sleep recorded", tone: "neutral", note: null });
  }

  // 3. Yesterday (relative to the anchor day): strain + workouts.
  const prevDay = shiftDate(anchor, -1);
  const cycle = cycles.find((c) => c.date === prevDay);
  const dayWorkouts = workouts.filter((w) => w.date === prevDay);
  {
    const parts: string[] = [];
    if (cycle && finite(cycle.strain)) parts.push(`Strain ${round1(cycle.strain)}`);
    if (dayWorkouts.length > 0) {
      const shown = dayWorkouts.slice(0, 3).map((w) => {
        const min = finite(w.duration_sec) ? Math.round(w.duration_sec / 60) : null;
        return min !== null ? `${sportLabel(w.sport)} ${min} min` : sportLabel(w.sport);
      });
      const extra = dayWorkouts.length - shown.length;
      parts.push(shown.join(", ") + (extra > 0 ? ` +${extra} more` : ""));
    } else if (parts.length > 0) {
      parts.push("no workouts");
    }
    lines.push({
      key: "yesterday",
      label: anchor === today ? "Yesterday" : friendlyDate(prevDay),
      text: parts.length > 0 ? parts.join(" · ") : "No strain recorded",
      tone: "neutral",
      note: null,
    });
  }

  // 4. Watch out — only evaluated against the day we actually have recovery for.
  const watch = latest
    ? watchOut(
        recovery.filter((r) => r.date <= anchor),
        sleep.filter((s) => s.date <= anchor),
        cycles.filter((c) => c.date <= anchor),
        anchor,
      )
    : null;
  if (watch) {
    lines.push({ key: "watch", label: "Watch out", text: watch.text, tone: "warn", note: null });
  }

  // 5. One plain suggestion, fixed rules in priority order.
  const target = needH ?? DEFAULT_SLEEP_NEED_H;
  let suggestion: string;
  if (!latest) {
    suggestion = "Recovery isn't scored yet — check back after Whoop finishes processing last night.";
  } else if (watch?.kind === "illness") {
    suggestion = "Your body may be fighting something — rest or keep movement easy, and protect tonight's sleep.";
  } else if (zone === "red") {
    suggestion = "Recovery is red — make it a rest or light-movement day.";
  } else if (watch?.kind === "overtraining") {
    suggestion = "Load has outpaced recovery this week — swap intensity for an easy session or a rest day.";
  } else if (zone === "green" && hours !== null && hours >= target * 0.9) {
    suggestion = `Recovery is green and you slept ${round1(hours)} h — good day for a hard session.`;
  } else if (zone === "green" && hours !== null) {
    suggestion = `Recovery is green but sleep was short (${round1(hours)} h) — train, but keep the hardest efforts brief.`;
  } else if (zone === "green") {
    suggestion = "Recovery is green — good day for a hard session.";
  } else {
    suggestion = "Recovery is yellow — a moderate session or steady cardio fits today.";
  }
  lines.push({
    key: "suggestion",
    label: "Suggestion",
    text: suggestion,
    tone: "neutral",
    note: latest && latest.date !== today ? `based on ${friendlyDate(latest.date)}` : null,
  });

  return { today, status: "ok", anchorDate: anchor, latestDataDate, lines };
}
