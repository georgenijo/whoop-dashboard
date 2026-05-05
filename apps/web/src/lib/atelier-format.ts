export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export function fmtHours(ms: number | null | undefined, precision = 1): string {
  if (ms == null) return "—";
  return (ms / 3_600_000).toFixed(precision);
}

export function pickAxisLabels(rows: { date: string }[], count = 5): string[] {
  if (rows.length === 0) return [];
  const indices = [
    0,
    Math.floor(rows.length / 4),
    Math.floor(rows.length / 2),
    Math.floor((rows.length * 3) / 4),
    rows.length - 1,
  ].slice(0, count);
  return Array.from(new Set(indices)).map((i) => {
    const d = new Date(rows[i].date + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });
}
