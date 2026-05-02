import "server-only";
import type { Tool, ToolResultBlockParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import {
  getJournalRange,
  getRecoveryRange,
  getSleepRange,
  getStrainRange,
  getWorkoutsRange,
} from "@/lib/db";

export type CoachToolName =
  | "query_recovery"
  | "query_sleep"
  | "query_strain"
  | "query_workouts"
  | "query_journal";

type DateRangeInput = {
  start_date: string;
  end_date: string;
};

type ToolSchema = Tool & {
  name: CoachToolName;
  description: string;
  input_schema: {
    type: "object";
    properties: {
      start_date: { type: "string"; description: string };
      end_date: { type: "string"; description: string };
    };
    required: ["start_date", "end_date"];
    additionalProperties: false;
  };
  strict: true;
};

const DATE_RANGE_SCHEMA: ToolSchema["input_schema"] = {
  type: "object",
  properties: {
    start_date: {
      type: "string",
      description: "Start date for the query, inclusive, in YYYY-MM-DD format.",
    },
    end_date: {
      type: "string",
      description: "End date for the query, inclusive, in YYYY-MM-DD format.",
    },
  },
  required: ["start_date", "end_date"],
  additionalProperties: false,
};

export const TOOLS: ToolSchema[] = [
  {
    name: "query_recovery",
    description:
      "Query daily Whoop recovery rows for a date range. Returns recovery_score, HRV, resting heart rate, SpO2, and skin temperature.",
    input_schema: DATE_RANGE_SCHEMA,
    strict: true,
  },
  {
    name: "query_sleep",
    description:
      "Query nightly Whoop sleep rows for a date range. Excludes naps and returns sleep duration/stages, need, performance, efficiency, disturbances, and respiratory rate.",
    input_schema: DATE_RANGE_SCHEMA,
    strict: true,
  },
  {
    name: "query_strain",
    description:
      "Query daily Whoop strain rows for a date range. Returns strain, kilojoules, average heart rate, and max heart rate.",
    input_schema: DATE_RANGE_SCHEMA,
    strict: true,
  },
  {
    name: "query_workouts",
    description:
      "Query Whoop workout rows for a date range. Returns sport, duration, heart rate, strain, and kilojoules.",
    input_schema: DATE_RANGE_SCHEMA,
    strict: true,
  },
  {
    name: "query_journal",
    description:
      "Query journal rows for a date range when journal data exists. Returns an empty array when no journal table is available.",
    input_schema: DATE_RANGE_SCHEMA,
    strict: true,
    cache_control: { type: "ephemeral", ttl: "1h" },
  },
];

export class ToolInputError extends Error {
  readonly details: unknown;

  constructor(message: string, details: unknown) {
    super(message);
    this.name = "ToolInputError";
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseDateRangeInput(input: unknown): DateRangeInput {
  if (!isRecord(input)) {
    throw new ToolInputError("Tool input must be an object.", {
      code: "invalid_input",
      expected: { start_date: "YYYY-MM-DD", end_date: "YYYY-MM-DD" },
      received: input,
    });
  }

  const { start_date: startDate, end_date: endDate } = input;
  if (typeof startDate !== "string" || !isValidDate(startDate)) {
    throw new ToolInputError("start_date must be a valid YYYY-MM-DD date.", {
      code: "invalid_start_date",
      expected: "YYYY-MM-DD",
      received: startDate,
    });
  }
  if (typeof endDate !== "string" || !isValidDate(endDate)) {
    throw new ToolInputError("end_date must be a valid YYYY-MM-DD date.", {
      code: "invalid_end_date",
      expected: "YYYY-MM-DD",
      received: endDate,
    });
  }
  if (startDate > endDate) {
    throw new ToolInputError("start_date must be before or equal to end_date.", {
      code: "invalid_date_range",
      start_date: startDate,
      end_date: endDate,
    });
  }

  return { start_date: startDate, end_date: endDate };
}

export async function executeTool(name: string, input: unknown): Promise<unknown> {
  const { start_date: startDate, end_date: endDate } = parseDateRangeInput(input);

  switch (name) {
    case "query_recovery":
      return getRecoveryRange(startDate, endDate);
    case "query_sleep":
      return getSleepRange(startDate, endDate);
    case "query_strain":
      return getStrainRange(startDate, endDate);
    case "query_workouts":
      return getWorkoutsRange(startDate, endDate);
    case "query_journal":
      return getJournalRange(startDate, endDate);
    default:
      throw new ToolInputError(`Unknown tool: ${name}`, {
        code: "unknown_tool",
        tool: name,
        available_tools: TOOLS.map((tool) => tool.name),
      });
  }
}

export type ToolDetail = {
  name: string;
  input: unknown;
  duration_ms: number;
  rows: number | null;
  status: "ok" | "error";
  error?: string;
};

function toolErrorPayload(err: unknown): string {
  if (err instanceof ToolInputError) {
    return JSON.stringify({
      error: err.message,
      details: err.details,
    });
  }
  return JSON.stringify({
    error: err instanceof Error ? err.message : String(err),
  });
}

export async function executeToolResult(
  threadId: number,
  toolUse: ToolUseBlock,
  toolDetails: ToolDetail[]
): Promise<ToolResultBlockParam> {
  const startMs = Date.now();
  console.info("[coach] tool_call", {
    thread_id: threadId,
    name: toolUse.name,
  });

  try {
    const result = await executeTool(toolUse.name, toolUse.input);
    const durationMs = Date.now() - startMs;
    const rows = Array.isArray(result) ? result.length : null;
    toolDetails.push({
      name: toolUse.name,
      input: toolUse.input,
      duration_ms: durationMs,
      rows,
      status: "ok",
    });
    console.info("[coach] tool_result", {
      thread_id: threadId,
      name: toolUse.name,
      duration_ms: durationMs,
      rows,
      status: "ok",
    });
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: JSON.stringify(result),
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const error = err instanceof Error ? err.message : String(err);
    toolDetails.push({
      name: toolUse.name,
      input: toolUse.input,
      duration_ms: durationMs,
      rows: null,
      status: "error",
      error,
    });
    console.warn("[coach] tool_result", {
      thread_id: threadId,
      name: toolUse.name,
      duration_ms: durationMs,
      status: "error",
      error,
    });
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: toolErrorPayload(err),
      is_error: true,
    };
  }
}

export function chatLogToolSummaries(toolDetails: ToolDetail[]) {
  return toolDetails.map(({ name, input, duration_ms, rows, status, error }) => ({
    name,
    input,
    duration_ms,
    rows,
    status,
    ...(error ? { error: error.slice(0, 200) } : {}),
  }));
}
