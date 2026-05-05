import "server-only";
import type { Tool, ToolResultBlockParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import {
  getJournalRange,
  getNaps,
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
  | "query_journal"
  | "query_naps";

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
      "Query daily Whoop recovery rows for a date range. Returns recovery_score (0-100), HRV (ms), resting heart rate (bpm), SpO2 (%), and skin temperature (degrees C).",
    input_schema: DATE_RANGE_SCHEMA,
    strict: true,
  },
  {
    name: "query_sleep",
    description:
      "Query nightly Whoop sleep rows for a date range. Excludes naps. Returns sleep duration, stage breakdown (light/deep/REM/awake ms), sleep need (with baseline / debt / strain / nap-credit components when available), performance, efficiency, consistency, disturbances, cycles, respiratory rate, and local-time bedtime/waketime when available (start_local/end_local in YYYY-MM-DDTHH:MM:SS format).",
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
      "Query Whoop workout rows for a date range. Returns sport, duration, heart rate (avg/max), strain, kilojoules, distance (meters), and time-in-zone breakdown (zone_0_ms through zone_5_ms; zone 2 = aerobic base, zones 4-5 = high intensity).",
    input_schema: DATE_RANGE_SCHEMA,
    strict: true,
  },
  {
    name: "query_naps",
    description:
      "Query Whoop nap rows (naps only — excludes nightly sleep) for a date range. Returns date, duration_ms, performance, efficiency, and stage breakdown (light/deep/REM/awake ms).",
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
    case "query_naps":
      return getNaps(startDate, endDate);
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

export type ToolProgressHandlers = {
  onToolUseStart?: (event: { name: string; input: unknown }) => void;
  onToolUseEnd?: (event: {
    name: string;
    duration_ms: number;
    rows: number | null;
    status: "ok" | "error";
    error?: string;
  }) => void;
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
  toolDetails: ToolDetail[],
  progress?: ToolProgressHandlers
): Promise<ToolResultBlockParam> {
  const startMs = Date.now();
  progress?.onToolUseStart?.({ name: toolUse.name, input: toolUse.input });
  console.info("[coach] tool_call", {
    thread_id: threadId,
    name: toolUse.name,
  });

  let result: unknown;
  try {
    result = await executeTool(toolUse.name, toolUse.input);
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
    progress?.onToolUseEnd?.({
      name: toolUse.name,
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

  const durationMs = Date.now() - startMs;
  const rows = Array.isArray(result) ? result.length : null;
  toolDetails.push({
    name: toolUse.name,
    input: toolUse.input,
    duration_ms: durationMs,
    rows,
    status: "ok",
  });
  progress?.onToolUseEnd?.({
    name: toolUse.name,
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
