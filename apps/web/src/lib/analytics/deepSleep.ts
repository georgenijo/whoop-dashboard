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
