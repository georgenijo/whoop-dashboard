// Deterministic 30-day series shared by the chart-markers baseline render
// tests. The baseline HTML files next to this one were captured from the
// charts BEFORE marker support existed, so equality proves flag-off output is
// byte-identical.
const START = Date.UTC(2026, 9, 20); // 2026-10-20, spans the Nov 1 US DST end

function dateAt(i: number): string {
  return new Date(START + i * 86_400_000).toISOString().slice(0, 10);
}

export const FIXTURE_DATES: string[] = Array.from({ length: 30 }, (_, i) => dateAt(i));

export const FIXTURE_RECOVERY = FIXTURE_DATES.map((date, i) => ({
  date,
  value: i === 12 ? null : 40 + ((i * 37) % 55),
}));

export const FIXTURE_HRV = FIXTURE_DATES.map((date, i) => ({
  date,
  hrv: i === 5 ? null : 45 + ((i * 13) % 30) + (i === 22 ? -25 : 0),
}));
