import "server-only";
import type { CycleRow, SleepRow } from "@/lib/db";

const MS_PER_HOUR = 3_600_000;

export type DeepSleepEffRow = {
  date: string;
  deep_hrs: number;
  prior_strain: number;
  ratio: number;
};

function priorDate(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function computeDeepSleepEfficiency(
  sleep: SleepRow[],
  cycles: CycleRow[],
): DeepSleepEffRow[] {
  const strainByDate = new Map<string, number>();
  for (const c of cycles) {
    if (c.strain != null && Number.isFinite(c.strain)) {
      strainByDate.set(c.date, c.strain);
    }
  }

  const out: DeepSleepEffRow[] = [];
  for (const s of sleep) {
    if (s.deep_ms == null) continue;
    const prior = strainByDate.get(priorDate(s.date));
    if (prior == null || prior <= 0) continue;
    const deep_hrs = s.deep_ms / MS_PER_HOUR;
    out.push({
      date: s.date,
      deep_hrs,
      prior_strain: prior,
      ratio: deep_hrs / prior,
    });
  }

  if (out.length < 7) return [];
  return out;
}

const MS_PER_MINUTE = 60_000;

/** Per-night stage durations in minutes (`total` = light + deep + REM + awake). */
export type StageMinutes = {
  light: number;
  deep: number;
  rem: number;
  awake: number;
  total: number;
};

function finiteMs(v: number | null): v is number {
  return v != null && Number.isFinite(v) && v >= 0;
}

/**
 * Stage minutes for one night, or `null` when the night has no usable stage
 * data: any of light/deep/REM/awake missing, negative or non-finite, or no
 * asleep time at all. Durations come straight from Whoop's millisecond
 * fields, so a DST night needs no clock arithmetic here. Used by
 * `sleepStages.ts`; `computeDeepSleepEfficiency` above is unchanged.
 */
export function stageMinutesFromRow(
  s: Pick<SleepRow, "light_ms" | "deep_ms" | "rem_ms" | "awake_ms">,
): StageMinutes | null {
  const { light_ms, deep_ms, rem_ms, awake_ms } = s;
  if (!finiteMs(light_ms) || !finiteMs(deep_ms) || !finiteMs(rem_ms) || !finiteMs(awake_ms)) {
    return null;
  }
  if (light_ms + deep_ms + rem_ms <= 0) return null;
  const light = light_ms / MS_PER_MINUTE;
  const deep = deep_ms / MS_PER_MINUTE;
  const rem = rem_ms / MS_PER_MINUTE;
  const awake = awake_ms / MS_PER_MINUTE;
  return { light, deep, rem, awake, total: light + deep + rem + awake };
}
