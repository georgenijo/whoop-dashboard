export type SeriesSummary = {
  /** The latest value, formatted with its unit ("62 ms", "78%"). */
  latest: string;
  /** Signed change from the first to the latest value ("↑ 2 ms"), or null for one point. */
  change: string | null;
  direction: "up" | "down" | "flat";
};

function withUnit(value: number, unit: string): string {
  const text = value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (!unit) return text;
  return unit === "%" ? `${text}%` : `${text} ${unit}`;
}

/**
 * The headline a chart leads with: where the series ended and how far it moved
 * across the window. Gaps (null) are skipped so a missing day neither starts
 * nor ends the comparison. Percentages move in points, not percent.
 */
export function summarizeSeries(values: ReadonlyArray<number | null | undefined>, unit: string): SeriesSummary | null {
  const numeric = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (numeric.length === 0) return null;
  const first = numeric[0];
  const last = numeric[numeric.length - 1];
  const latest = withUnit(last, unit);
  if (numeric.length < 2) return { latest, change: null, direction: "flat" };
  const delta = Number((last - first).toFixed(1));
  if (delta === 0) return { latest, change: "Flat", direction: "flat" };
  const magnitude = Math.abs(delta);
  const changeUnit = unit === "%" ? (magnitude === 1 ? "pt" : "pts") : unit;
  const amount = magnitude.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return {
    latest,
    change: `${delta > 0 ? "↑" : "↓"} ${changeUnit ? `${amount} ${changeUnit}` : amount}`,
    direction: delta > 0 ? "up" : "down",
  };
}

/** A DOM-safe id fragment from React's `useId()` output (which contains colons). */
export function svgSafeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}
