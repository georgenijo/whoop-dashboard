type RecoveryInput = {
  date: string;
  recovery_score: number | null;
};

export type ReboundEvent = {
  red_date: string;
  green_date: string;
  days_to_rebound: number;
};

const RED_THRESHOLD = 33;
const GREEN_THRESHOLD = 66;
const MS_PER_DAY = 86_400_000;

export function computeRebound(recovery: RecoveryInput[]): ReboundEvent[] {
  const valid = recovery
    .filter(
      (r): r is { date: string; recovery_score: number } =>
        r.recovery_score != null && Number.isFinite(r.recovery_score)
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (valid.length < 2) return [];

  const events: ReboundEvent[] = [];
  // One event per red episode (streak start), not per red day, so long red runs don't double-count.
  for (let i = 0; i < valid.length; i++) {
    if (valid[i].recovery_score >= RED_THRESHOLD) continue;
    if (i > 0 && valid[i - 1].recovery_score < RED_THRESHOLD) continue;

    for (let j = i + 1; j < valid.length; j++) {
      if (valid[j].recovery_score > GREEN_THRESHOLD) {
        const redMs = new Date(valid[i].date + "T00:00:00Z").getTime();
        const greenMs = new Date(valid[j].date + "T00:00:00Z").getTime();
        events.push({
          red_date: valid[i].date,
          green_date: valid[j].date,
          days_to_rebound: Math.round((greenMs - redMs) / MS_PER_DAY),
        });
        break;
      }
    }
  }
  return events;
}
