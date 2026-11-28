import "server-only";
import type { CycleRow, RecoveryRow } from "@/lib/db";
import { recoveryBand, type Band } from "@/components/plans/band";
import { computeIllnessSignal } from "./illness";
import { computeOTS } from "./ots";
import { computeTrainingLoad } from "./trainingLoad";

// ---------------------------------------------------------------------------
// Today's strain target — "how hard should I push today?"
//
// Pure computation over rows the /strain page already reads (plus one
// user-scoped recovery window when STRAIN_TARGET=1). No network, no LLM.
// Output is guidance, not medical advice; the card says so.
// ---------------------------------------------------------------------------

/** Server-side feature flag. Off unless exactly "1". */
export function isStrainTargetEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.STRAIN_TARGET === "1";
}

/**
 * Target zones on Whoop's 0–21 day-strain scale. Ordered easiest → hardest so
 * "step down one zone" is `index - 1`. The bands overlap by a point on
 * purpose: strain is logarithmic and the edges are fuzzy, not cliffs.
 *  - restore  4–9   light movement; what a low-recovery day can absorb
 *  - maintain 8–12  ordinary training day, holds fitness without adding load
 *  - build    11–14 a solid session that nudges fitness up
 *  - push     14–18 a hard day; only when recovered and fresh
 */
export const STRAIN_ZONES = [
  { id: "restore", label: "Restore", low: 4, high: 9 },
  { id: "maintain", label: "Maintain", low: 8, high: 12 },
  { id: "build", label: "Build", low: 11, high: 14 },
  { id: "push", label: "Push", low: 14, high: 18 },
] as const;

export type StrainZoneId = (typeof STRAIN_ZONES)[number]["id"];
export type StrainZone = (typeof STRAIN_ZONES)[number];

/** Whoop's day-strain scale ceiling (used by the card's progress bar). */
export const STRAIN_SCALE_MAX = 21;

/**
 * Starting zone per recovery band (bands from `recoveryBand`: high ≥ 67,
 * mid 34–66, low < 34) — the same green/yellow/red split Whoop uses.
 */
export const BAND_BASE_ZONE: Record<Band, StrainZoneId> = {
  high: "push",
  mid: "maintain",
  low: "restore",
};

/**
 * Training-stress balance (TSB = CTL − ATL, in strain units, from the same
 * EWMA as the TSB chart). Below FATIGUED the last week has run well ahead of
 * the long-term base, so step the target down one zone. Above FRESH the user
 * is under-loaded relative to their base, so a mid-recovery day may step up
 * one zone. ±2 strain is roughly one easy day vs one hard day of difference.
 */
export const TSB_FATIGUED = -2;
export const TSB_FRESH = 2;

/**
 * Ramp guard: if a zone's floor sits more than this far above the user's
 * 7-day average strain, step down one zone — jump load gradually, not in one
 * day.
 */
export const RAMP_LIMIT = 6;

/**
 * Minimum prior days with a recorded strain before the TSB and ramp
 * adjustments are trusted. Below this the target is recovery-band only.
 */
export const MIN_HISTORY_DAYS = 7;

/**
 * How stale the recovery behind the target may be. With no scored recovery
 * today we fall back to the latest scored day up to this many days back; past
 * that there is no target.
 */
export const MAX_RECOVERY_FALLBACK_DAYS = 3;

/** Overtraining (OTS 3/3 signals) and illness (≥2 vitals off baseline) caps. */
export const ILLNESS_CAP_ZONE: StrainZoneId = "restore";
export const OVERTRAINING_CAP_ZONE: StrainZoneId = "maintain";

export type StrainTargetInput = {
  /** Local date YYYY-MM-DD. */
  today: string;
  /** Recovery rows (any order) — ideally ~4 weeks for illness baselines. */
  recovery: RecoveryRow[];
  /** Cycle rows (any order) — ideally months, for a warmed-up CTL. */
  cycles: Pick<CycleRow, "date" | "strain">[];
};

export type StrainTargetCap = "illness" | "overtraining";

export type StrainTarget =
  | {
      status: "ok";
      zone: StrainZone;
      low: number;
      high: number;
      reason: string;
      recoveryDate: string;
      recoveryScore: number;
      band: Band;
      /** Days between the recovery used and `today` (0 = today's). */
      recoveryAgeDays: number;
      cap: StrainTargetCap | null;
      limitedHistory: boolean;
      avg7: number | null;
      tsb: number | null;
    }
  | { status: "unavailable"; reason: string };

/** Whole days from `a` to `b` (YYYY-MM-DD), DST-safe. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function shiftIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function zoneIndex(id: StrainZoneId): number {
  return STRAIN_ZONES.findIndex((z) => z.id === id);
}

const fmt1 = (n: number) => n.toFixed(1);

export function computeStrainTarget(input: StrainTargetInput): StrainTarget {
  const { today } = input;
  const byDate = <T extends { date: string }>(rows: T[]) =>
    [...rows].sort((a, b) => a.date.localeCompare(b.date));

  // Future-dated rows (clock skew, tz mismatch) are ignored.
  const recovery = byDate(input.recovery.filter((r) => r.date <= today));
  const scored = recovery.filter(
    (r) => r.recovery_score != null && Number.isFinite(r.recovery_score),
  );
  const latest = scored[scored.length - 1];
  if (!latest) {
    return {
      status: "unavailable",
      reason: "No scored recovery yet — wear your strap overnight to get a target.",
    };
  }
  const recoveryAgeDays = daysBetween(latest.date, today);
  if (recoveryAgeDays > MAX_RECOVERY_FALLBACK_DAYS) {
    return {
      status: "unavailable",
      reason: `Latest scored recovery is ${recoveryAgeDays} days old — too stale to set a target.`,
    };
  }
  const recoveryScore = latest.recovery_score as number;
  const band = recoveryBand(recoveryScore);

  // Prior-day load only: today's cycle is still in progress and would read as
  // a sudden rest day in ATL.
  const prior = byDate(
    input.cycles.filter((c) => c.date < today),
  );
  const priorWithStrain = prior.filter(
    (c) => c.strain != null && Number.isFinite(c.strain),
  );
  const limitedHistory = priorWithStrain.length < MIN_HISTORY_DAYS;

  const weekStart = shiftIso(today, -7);
  const week = priorWithStrain.filter((c) => c.date >= weekStart);
  const avg7 =
    week.length > 0
      ? week.reduce((s, c) => s + (c.strain as number), 0) / week.length
      : null;

  const load = computeTrainingLoad(prior);
  const tsb = load.length > 0 ? load[load.length - 1].tsb : null;

  let idx = zoneIndex(BAND_BASE_ZONE[band]);
  const notes: string[] = [];

  if (!limitedHistory && tsb != null) {
    if (tsb < TSB_FATIGUED && idx > 0) {
      idx -= 1;
      notes.push(`recent load is ahead of your base (form ${fmt1(tsb)})`);
    } else if (tsb > TSB_FRESH && band === "mid" && idx < STRAIN_ZONES.length - 1) {
      idx += 1;
      notes.push(`you're fresh (form +${fmt1(tsb)})`);
    }
  }
  if (!limitedHistory && avg7 != null && idx > 0 && STRAIN_ZONES[idx].low > avg7 + RAMP_LIMIT) {
    idx -= 1;
    notes.push(`ramping up from a ${fmt1(avg7)} weekly average`);
  }

  // Caps from the illness / overtraining analytics. Illness is judged on the
  // recovery day we're using, not a stale one.
  let cap: StrainTargetCap | null = null;
  const illness = computeIllnessSignal(recovery, []);
  const illnessToday = illness.find((r) => r.date === latest.date);
  if (illnessToday?.illness_flag) {
    cap = "illness";
    idx = Math.min(idx, zoneIndex(ILLNESS_CAP_ZONE));
  }
  if (cap == null) {
    const ots = computeOTS(recovery, prior);
    if (ots?.level === "high") {
      cap = "overtraining";
      idx = Math.min(idx, zoneIndex(OVERTRAINING_CAP_ZONE));
    }
  }

  const zone = STRAIN_ZONES[idx];
  const when =
    recoveryAgeDays === 0
      ? "today"
      : recoveryAgeDays === 1
        ? "yesterday (no scored recovery yet today)"
        : `${recoveryAgeDays} days ago (no scored recovery since)`;
  const head = `Recovery ${Math.round(recoveryScore)}% ${when}`;
  let reason: string;
  if (cap === "illness") {
    reason = `${head}, but RHR/HRV/skin temp look off baseline — keep it light.`;
  } else if (cap === "overtraining") {
    reason = `${head}, but a week of falling HRV and recovery under steady load suggests overreaching — hold at maintain.`;
  } else if (notes.length > 0) {
    reason = `${head}; ${notes.join("; ")}.`;
  } else {
    reason = `${head}${band === "high" ? " — you're primed for a hard day." : band === "mid" ? " — a normal training day." : " — prioritise recovery."}`;
  }
  if (limitedHistory) {
    reason += ` Based on recovery only — ${priorWithStrain.length} day${priorWithStrain.length === 1 ? "" : "s"} of strain history so far.`;
  }

  return {
    status: "ok",
    zone,
    low: zone.low,
    high: zone.high,
    reason,
    recoveryDate: latest.date,
    recoveryScore,
    band,
    recoveryAgeDays,
    cap,
    limitedHistory,
    avg7,
    tsb,
  };
}

export type StrainProgress = "none" | "below" | "in" | "above";

/** Where today's strain so far sits against the target range. */
export function strainProgress(
  strainSoFar: number | null,
  low: number,
  high: number,
): StrainProgress {
  if (strainSoFar == null || !Number.isFinite(strainSoFar)) return "none";
  if (strainSoFar < low) return "below";
  if (strainSoFar > high) return "above";
  return "in";
}

/**
 * Today's day strain so far. Prefers today's cycle (Whoop's running day
 * strain); otherwise the hardest workout logged today, a lower bound since
 * day strain is never below any single workout's strain.
 */
export function todayStrainSoFar(
  today: string,
  cycles: Pick<CycleRow, "date" | "strain">[],
  todayWorkouts: { strain: number | null }[],
): { value: number | null; source: "cycle" | "workouts" | null } {
  const cycle = cycles.find((c) => c.date === today);
  if (cycle?.strain != null && Number.isFinite(cycle.strain)) {
    return { value: cycle.strain, source: "cycle" };
  }
  const ws = todayWorkouts
    .map((w) => w.strain)
    .filter((s): s is number => s != null && Number.isFinite(s));
  if (ws.length > 0) return { value: Math.max(...ws), source: "workouts" };
  return { value: null, source: null };
}
