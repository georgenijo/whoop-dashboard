/**
 * Catmull-Rom → cubic-bezier path generator.
 * Input points are [x, y] in the 0..100 viewBox the caller chose.
 * Ported from ~/Downloads/Whoop_ Design System/ui_kits/dashboard/Metrics.jsx:107-123.
 */
export function smoothPath(points: [number, number][]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const [x, y] = points[0];
    return `M ${x},${y}`;
  }
  let d = `M ${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/** Build a normalized polyline (viewBox 0 0 w h) from values, with min/max scaling. */
export function sparklinePoints(
  values: number[],
  width: number,
  height: number
): [number, number][] {
  if (values.length === 0) return [];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const n = values.length === 1 ? 1 : values.length - 1;
  return values.map((v, i) => [
    (i / n) * width,
    height - ((v - min) / range) * height,
  ]);
}
