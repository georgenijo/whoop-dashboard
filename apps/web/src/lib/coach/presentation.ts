export const PRESENTATION_VERSION = 1 as const;

type Direction = "up" | "down" | "neutral";
type Tone = "positive" | "warning" | "negative" | "neutral";

type BaseBlock = {
  version: typeof PRESENTATION_VERSION;
  fallback: string;
};

export type MetricStripBlock = BaseBlock & {
  type: "metric_strip";
  metrics: Array<{
    label: string;
    value: number | null;
    display_value: string;
    unit: string;
    direction: Direction;
    tone: Tone;
  }>;
};

export type ComparisonBlock = BaseBlock & {
  type: "comparison";
  title: string;
  items: Array<{
    label: string;
    current: number | null;
    baseline: number | null;
    delta: number | null;
    unit: string;
    direction: Direction;
  }>;
};

export type ChartBlock = BaseBlock & {
  type: "chart";
  title: string;
  labels: string[];
  series: Array<{
    id: string;
    label: string;
    unit: string;
    kind: "line" | "bar";
    values: Array<number | null>;
  }>;
  references: Array<{ label: string; value: number; unit: string }>;
  anomalies: Array<{ index: number; label: string }>;
};

export type ActionPlanBlock = BaseBlock & {
  type: "action_plan";
  title: string;
  sections: Array<{
    timeframe: "today" | "tonight" | "tomorrow" | "conditional";
    items: string[];
  }>;
};

export type DataFreshnessBlock = BaseBlock & {
  type: "data_freshness";
  sources: Array<{
    source: string;
    status: "fresh" | "stale" | "missing" | "syncing";
    last_available_date: string | null;
  }>;
  sync_available: boolean;
};

export type WorkoutPlanBlock = BaseBlock & {
  type: "workout_plan";
  title: string;
  date: string | null;
  exercises: Array<{
    name: string;
    prescription: string;
    notes: string;
  }>;
};

export type EvidenceBlock = BaseBlock & {
  type: "evidence";
  title: string;
  date_range: string;
  record_count: number;
  missing_days: number;
  sources: string[];
  points: string[];
};

export type CoachPresentationBlock =
  | MetricStripBlock
  | ComparisonBlock
  | ChartBlock
  | ActionPlanBlock
  | DataFreshnessBlock
  | WorkoutPlanBlock
  | EvidenceBlock;

export const MAX_PRESENTATION_BLOCKS = 8;
const MAX_TEXT = 240;
const MAX_ITEMS = 12;
const MAX_POINTS = 100;
const BLOCK_FENCE = /```coach-blocks\s*\n([\s\S]*?)```/gi;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max = MAX_TEXT): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max
    ? value.trim()
    : null;
}

function finite(value: unknown, nullable = false): number | null | undefined {
  if (nullable && value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): T | null {
  return typeof value === "string" && values.includes(value as T) ? (value as T) : null;
}

function strings(value: unknown, cap = MAX_ITEMS): string[] | null {
  if (!Array.isArray(value) || value.length > cap) return null;
  const parsed = value.map((item) => text(item));
  return parsed.every((item): item is string => item !== null) ? parsed : null;
}

function validateBlock(value: unknown): CoachPresentationBlock | null {
  const input = record(value);
  if (!input || input.version !== PRESENTATION_VERSION) return null;
  const type = text(input.type, 40);
  const fallback = text(input.fallback, 1_000);
  if (!type || !fallback) return null;

  if (type === "metric_strip") {
    if (!Array.isArray(input.metrics) || input.metrics.length < 1 || input.metrics.length > 6) return null;
    const metrics = input.metrics.map((raw) => {
      const item = record(raw);
      const label = text(item?.label, 80);
      const value = finite(item?.value, true);
      const display_value = text(item?.display_value, 40);
      const unit = typeof item?.unit === "string" && item.unit.length <= 30 ? item.unit : null;
      const direction = oneOf(item?.direction, ["up", "down", "neutral"] as const);
      const tone = oneOf(item?.tone, ["positive", "warning", "negative", "neutral"] as const);
      return label && value !== undefined && display_value && unit !== null && direction && tone
        ? { label, value, display_value, unit, direction, tone }
        : null;
    });
    return metrics.every((item): item is NonNullable<typeof item> => item !== null)
      ? { version: 1, type, fallback, metrics }
      : null;
  }

  if (type === "comparison") {
    const title = text(input.title, 120);
    if (!title || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 8) return null;
    const items = input.items.map((raw) => {
      const item = record(raw);
      const label = text(item?.label, 80);
      const current = finite(item?.current, true);
      const baseline = finite(item?.baseline, true);
      const delta = finite(item?.delta, true);
      const unit = typeof item?.unit === "string" && item.unit.length <= 30 ? item.unit : null;
      const direction = oneOf(item?.direction, ["up", "down", "neutral"] as const);
      return label && current !== undefined && baseline !== undefined && delta !== undefined && unit !== null && direction
        ? { label, current, baseline, delta, unit, direction }
        : null;
    });
    return items.every((item): item is NonNullable<typeof item> => item !== null)
      ? { version: 1, type, fallback, title, items }
      : null;
  }

  if (type === "chart") {
    const title = text(input.title, 160);
    const labels = strings(input.labels, MAX_POINTS);
    if (!title || !labels || labels.length < 2 || !Array.isArray(input.series) || input.series.length < 1 || input.series.length > 4) return null;
    const series = input.series.map((raw) => {
      const item = record(raw);
      const id = text(item?.id, 50);
      const label = text(item?.label, 80);
      const unit = typeof item?.unit === "string" && item.unit.length <= 30 ? item.unit : null;
      const kind = oneOf(item?.kind, ["line", "bar"] as const);
      const values = Array.isArray(item?.values) && item.values.length === labels.length
        ? item.values.map((point) => finite(point, true))
        : null;
      return id && label && unit !== null && kind && values?.every((point) => point !== undefined)
        ? { id, label, unit, kind, values: values as Array<number | null> }
        : null;
    });
    const references = Array.isArray(input.references) && input.references.length <= 6
      ? input.references.map((raw) => {
          const item = record(raw); const label = text(item?.label, 80); const value = finite(item?.value);
          const unit = typeof item?.unit === "string" && item.unit.length <= 30 ? item.unit : null;
          return label && value !== undefined && value !== null && unit !== null ? { label, value, unit } : null;
        })
      : null;
    const anomalies = Array.isArray(input.anomalies) && input.anomalies.length <= 12
      ? input.anomalies.map((raw) => {
          const item = record(raw); const label = text(item?.label, 80); const index = item?.index;
          return label && Number.isInteger(index) && (index as number) >= 0 && (index as number) < labels.length
            ? { label, index: index as number } : null;
        })
      : null;
    return series.every((item): item is NonNullable<typeof item> => item !== null) &&
      references?.every((item): item is NonNullable<typeof item> => item !== null) &&
      anomalies?.every((item): item is NonNullable<typeof item> => item !== null)
      ? { version: 1, type, fallback, title, labels, series, references, anomalies }
      : null;
  }

  if (type === "action_plan") {
    const title = text(input.title, 120);
    if (!title || !Array.isArray(input.sections) || input.sections.length < 1 || input.sections.length > 4) return null;
    const sections = input.sections.map((raw) => {
      const item = record(raw);
      const timeframe = oneOf(item?.timeframe, ["today", "tonight", "tomorrow", "conditional"] as const);
      const items = strings(item?.items, 6);
      return timeframe && items?.length ? { timeframe, items } : null;
    });
    return sections.every((item): item is NonNullable<typeof item> => item !== null)
      ? { version: 1, type, fallback, title, sections }
      : null;
  }

  if (type === "data_freshness") {
    if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 8 || typeof input.sync_available !== "boolean") return null;
    const sources = input.sources.map((raw) => {
      const item = record(raw); const source = text(item?.source, 80);
      const status = oneOf(item?.status, ["fresh", "stale", "missing", "syncing"] as const);
      const date = item?.last_available_date === null ? null : text(item?.last_available_date, 40);
      return source && status && date !== undefined ? { source, status, last_available_date: date } : null;
    });
    return sources.every((item): item is NonNullable<typeof item> => item !== null)
      ? { version: 1, type, fallback, sources, sync_available: input.sync_available }
      : null;
  }

  if (type === "workout_plan") {
    const title = text(input.title, 120);
    const date = input.date === null ? null : text(input.date, 40);
    if (!title || date === undefined || !Array.isArray(input.exercises) || input.exercises.length < 1 || input.exercises.length > 20) return null;
    const exercises = input.exercises.map((raw) => {
      const item = record(raw); const name = text(item?.name, 100); const prescription = text(item?.prescription, 160);
      const notes = typeof item?.notes === "string" && item.notes.length <= MAX_TEXT ? item.notes.trim() : null;
      return name && prescription && notes !== null ? { name, prescription, notes } : null;
    });
    return exercises.every((item): item is NonNullable<typeof item> => item !== null)
      ? { version: 1, type, fallback, title, date, exercises }
      : null;
  }

  if (type === "evidence") {
    const title = text(input.title, 120); const date_range = text(input.date_range, 100);
    const record_count = input.record_count; const missing_days = input.missing_days;
    const sources = strings(input.sources, 8); const points = strings(input.points, 12);
    return title && date_range && Number.isInteger(record_count) && (record_count as number) >= 0 &&
      Number.isInteger(missing_days) && (missing_days as number) >= 0 && sources && points
      ? { version: 1, type, fallback, title, date_range, record_count: record_count as number, missing_days: missing_days as number, sources, points }
      : null;
  }
  return null;
}

export function parseCoachPresentationBlocks(value: unknown): CoachPresentationBlock[] {
  if (!Array.isArray(value) || value.length > MAX_PRESENTATION_BLOCKS) return [];
  const blocks = value.map(validateBlock);
  return blocks.every((block): block is CoachPresentationBlock => block !== null) ? blocks : [];
}

export function extractCoachPresentation(reply: string): {
  reply: string;
  presentationBlocks: CoachPresentationBlock[];
} {
  const proposals: unknown[] = [];
  let malformed = false;
  for (const match of reply.matchAll(BLOCK_FENCE)) {
    try {
      const parsed = JSON.parse(match[1]);
      if (!Array.isArray(parsed)) malformed = true;
      else proposals.push(...parsed);
    } catch {
      malformed = true;
    }
  }
  if (malformed || proposals.length === 0) return { reply, presentationBlocks: [] };
  const presentationBlocks = parseCoachPresentationBlocks(proposals);
  if (presentationBlocks.length === 0) return { reply, presentationBlocks: [] };
  return {
    reply: reply.replace(BLOCK_FENCE, "").replace(/\n{3,}/g, "\n\n").trim(),
    presentationBlocks,
  };
}
