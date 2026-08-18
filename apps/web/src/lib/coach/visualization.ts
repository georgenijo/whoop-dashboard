export type CoachChartSpec = {
  type: "line" | "bar";
  title: string;
  unit: string;
  labels: string[];
  values: number[];
  yMin: number | null;
  yMax: number | null;
};

export type CoachContentSegment =
  | { type: "markdown"; content: string }
  | { type: "chart"; chart: CoachChartSpec };

const MERMAID_FENCE = /```mermaid\s*\n([\s\S]*?)```/gi;
const MAX_CHART_POINTS = 100;

function quotedValue(line: string, key: string): string | null {
  const match = line.match(new RegExp(`^${key}\\s+("(?:[^"\\\\]|\\\\.)*")\\s*$`, "i"));
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function arrayValue(line: string, key: string): unknown[] | null {
  const match = line.match(new RegExp(`^${key}\\s+(\\[[^\\n]*\\])\\s*$`, "i"));
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function parseMermaidXyChart(source: string): CoachChartSpec | null {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0]?.toLowerCase() !== "xychart-beta") return null;

  let title = "Chart";
  let unit = "";
  let labels: string[] | null = null;
  let values: number[] | null = null;
  let type: CoachChartSpec["type"] | null = null;
  let yMin: number | null = null;
  let yMax: number | null = null;

  for (const line of lines.slice(1)) {
    const parsedTitle = quotedValue(line, "title");
    if (parsedTitle !== null) {
      title = parsedTitle.slice(0, 160);
      continue;
    }

    const axis = arrayValue(line, "x-axis");
    if (axis) {
      if (!axis.every((value) => typeof value === "string")) return null;
      labels = (axis as string[]).map((value) => value.slice(0, 60));
      continue;
    }

    const yAxis = line.match(
      /^y-axis(?:\s+"([^"\n]{0,30})")?\s+(-?\d+(?:\.\d+)?)\s*-->\s*(-?\d+(?:\.\d+)?)$/i,
    );
    if (yAxis) {
      unit = yAxis[1] ?? "";
      yMin = Number(yAxis[2]);
      yMax = Number(yAxis[3]);
      if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMin >= yMax) {
        return null;
      }
      continue;
    }

    for (const candidate of ["line", "bar"] as const) {
      const series = arrayValue(line, candidate);
      if (!series) continue;
      if (!series.every((value) => typeof value === "number" && Number.isFinite(value))) {
        return null;
      }
      if (values !== null) return null;
      type = candidate;
      values = series as number[];
    }
  }

  if (
    !labels ||
    !values ||
    !type ||
    labels.length < 2 ||
    labels.length > MAX_CHART_POINTS ||
    labels.length !== values.length
  ) {
    return null;
  }

  return { type, title, unit, labels, values, yMin, yMax };
}

export function parseCoachVisualizations(content: string): CoachContentSegment[] {
  const segments: CoachContentSegment[] = [];
  let cursor = 0;

  for (const match of content.matchAll(MERMAID_FENCE)) {
    const index = match.index ?? 0;
    const chart = parseMermaidXyChart(match[1]);
    if (!chart) continue;
    if (index > cursor) {
      segments.push({ type: "markdown", content: content.slice(cursor, index) });
    }
    segments.push({ type: "chart", chart });
    cursor = index + match[0].length;
  }

  if (cursor === 0) return [{ type: "markdown", content }];
  if (cursor < content.length) {
    segments.push({ type: "markdown", content: content.slice(cursor) });
  }
  return segments.filter(
    (segment) => segment.type === "chart" || segment.content.trim().length > 0,
  );
}
