import "server-only";
import type { Tool, ToolResultBlockParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import {
  addSyncLog,
  getJournalRange,
  getLastSuccessfulSyncAt,
  getNaps,
  getRecoveryRange,
  getSleepRange,
  getStrainRange,
  getUserSettings,
  getWorkoutsRange,
} from "@/lib/db";
import type { WorkoutRow } from "@/lib/db";
import {
  runWhoopSync,
  SYNC_COOLDOWN_MS,
  type SyncProgressEvent,
  type SyncResult,
} from "@/lib/sync";
import { PARTIAL_ERROR_FALLBACK } from "@/lib/sync-meta";

export type CoachToolName =
  | "query_recovery"
  | "query_sleep"
  | "query_strain"
  | "query_workouts"
  | "query_journal"
  | "query_naps"
  | "trigger_whoop_sync";

type DateRangeInput = {
  start_date: string;
  end_date: string;
};

type DateRangeToolSchema = Tool & {
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

type EmptyInputToolSchema = Tool & {
  name: CoachToolName;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, never>;
    required: [];
    additionalProperties: false;
  };
  strict: true;
};

type ToolSchema = DateRangeToolSchema | EmptyInputToolSchema;

const DATE_RANGE_SCHEMA: DateRangeToolSchema["input_schema"] = {
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

const EMPTY_INPUT_SCHEMA: EmptyInputToolSchema["input_schema"] = {
  type: "object",
  properties: {},
  required: [],
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
      "Query Whoop workout rows for a date range. Returns sport, duration, heart rate (avg/max), strain, kilojoules, distance (meters), time-in-zone breakdown (zone_0_ms through zone_5_ms; zone 2 = aerobic base, zones 4-5 = high intensity), and workout timestamps in UTC and user-local time (start_utc/end_utc as ISO 8601 UTC; start_local/end_local in YYYY-MM-DDTHH:MM:SS format when the user's timezone is known).",
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
  {
    name: "trigger_whoop_sync",
    description:
      "Pull the latest Whoop data into the local DB. Idempotent. Takes 10-30s. " +
      "Returns one of: " +
      "{ success: true, ...sync details } on a fresh sync; " +
      "{ success: true, skipped: true, reason, last_sync_at, cooldown_window_seconds, next_sync_allowed_at } when a recent sync is still within the cooldown window — the DB may already have fresh rows; re-query before answering and use next_sync_allowed_at to tell the user when they can sync again; " +
      "{ success: false, already_synced: true, error } if this turn already attempted a sync; " +
      "{ success: false, error, ... } on any other failure.",
    input_schema: EMPTY_INPUT_SCHEMA,
    strict: true,
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

// Format a UTC ISO timestamp as a naive local ISO (YYYY-MM-DDTHH:MM:SS) in the
// given IANA tz via Intl. DST-correct through ICU. Returns null on missing
// input or invalid tz so the surrounding payload still serialises cleanly.
// Mirrors the wording the sleep tool description uses for start_local/end_local.
function formatLocalIso(utcIso: string | null, tz: string): string | null {
  if (!utcIso) return null;
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    const year = get("year");
    const month = get("month");
    const day = get("day");
    // Intl returns "24" for midnight in some locales — clamp to "00".
    let hour = get("hour");
    if (hour === "24") hour = "00";
    const minute = get("minute");
    const second = get("second");
    if (!year || !month || !day || !minute || !second) return null;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  } catch {
    return null;
  }
}

/**
 * Per-turn state shared across `executeTool` calls. Tracks how many times
 * `trigger_whoop_sync` has been invoked so we can hard-cap it at one
 * actual sync attempt per chat turn (cooldown skips don't count).
 */
export type ToolTurnState = {
  syncAttempts: number;
};

export function newToolTurnState(): ToolTurnState {
  return { syncAttempts: 0 };
}

/**
 * Result shape returned by the `trigger_whoop_sync` tool. Either the full
 * `SyncResult` from `runWhoopSync`, a cooldown-skipped marker, or a
 * "already attempted this turn" refusal.
 */
type SyncToolSkipped = {
  success: true;
  skipped: true;
  reason: string;
  last_sync_at: string;
  cooldown_window_seconds: number;
  next_sync_allowed_at: string;
};

type SyncToolAlreadyAttempted = {
  success: false;
  error: string;
  already_synced: true;
};

type SyncToolResult = SyncResult | SyncToolSkipped | SyncToolAlreadyAttempted;

async function handleTriggerWhoopSync(
  userId: number,
  turnState: ToolTurnState,
  signal?: AbortSignal,
  onProgress?: (e: SyncProgressEvent) => void,
): Promise<SyncToolResult> {
  // Hard cap: one sync attempt per chat turn. Prevents tool-loop runaway
  // where the model retries trigger_whoop_sync after a non-cooldown failure.
  // Cooldown skips don't increment the counter — they're cheap.
  if (turnState.syncAttempts >= 1) {
    return {
      success: false,
      error: "Sync already attempted this turn",
      already_synced: true,
    };
  }

  // Cooldown short-circuit. Mirrors `/api/sync/route.ts` so the manual
  // button and Coach share one cadence and a single fresh sync covers both.
  // No `sync_logs` row on skip — matches route behavior.
  const lastOk = getLastSuccessfulSyncAt();
  if (lastOk && Date.now() - lastOk.getTime() < SYNC_COOLDOWN_MS) {
    return {
      success: true,
      skipped: true,
      reason: "Recent sync within cooldown window",
      last_sync_at: lastOk.toISOString(),
      cooldown_window_seconds: SYNC_COOLDOWN_MS / 1000,
      next_sync_allowed_at: new Date(
        lastOk.getTime() + SYNC_COOLDOWN_MS,
      ).toISOString(),
    };
  }

  turnState.syncAttempts += 1;

  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const result = await runWhoopSync({ userId, signal, onProgress });
  const durationMs = Date.now() - t0;

  // Persist a sync_logs row so Coach-driven syncs are visible in /logs and
  // — critically — feed the cooldown gate via getLastSuccessfulSyncAt().
  // Mirror the route's payload shape so /logs renders consistently. Wrap in
  // try/catch: if addSyncLog fails (DB locked, disk full, schema error),
  // runWhoopSync has already committed data — losing the SyncResult to the
  // model is a worse outcome than failing the cooldown gate open on the
  // next request.
  try {
    if (result.success) {
      addSyncLog({
        started_at: startedAt,
        duration_ms: durationMs,
        status: "ok",
        recovery_count: result.fetched_counts.recovery,
        sleep_count: result.fetched_counts.sleep,
        workouts_count: result.fetched_counts.workouts,
        error_message: result.partial
          ? (result.error ?? PARTIAL_ERROR_FALLBACK).slice(0, 800)
          : null,
        source: "coach",
        details: JSON.stringify({
          ...result.details,
          rows_inserted: result.rows_inserted,
          fetched_counts: result.fetched_counts,
          latest_recovery_date: result.latest_recovery_date,
          latest_sleep_date: result.latest_sleep_date,
          latest_strain_date: result.latest_strain_date,
        }),
        partial: result.partial === true,
      });
    } else {
      addSyncLog({
        started_at: startedAt,
        duration_ms: durationMs,
        status: "error",
        recovery_count: result.fetched_counts.recovery,
        sleep_count: result.fetched_counts.sleep,
        workouts_count: result.fetched_counts.workouts,
        error_message: (result.error ?? "sync failed").slice(0, 800),
        source: "coach",
        details: JSON.stringify({
          ...result.details,
          rows_inserted: result.rows_inserted,
          fetched_counts: result.fetched_counts,
        }),
        partial: false,
      });
    }
  } catch (err) {
    console.error("[coach] sync_log_write_failed", {
      error: err instanceof Error ? err.message : String(err),
      sync_success: result.success,
    });
  }

  return result;
}

export async function executeTool(
  name: string,
  input: unknown,
  options: {
    /**
     * Owner of the Whoop integration to act against. Threaded explicitly
     * so the sync tool lands tokens / refresh state on the right user
     * instead of falling back to a hardcoded id.
     */
    userId: number;
    turnState: ToolTurnState;
    signal?: AbortSignal;
    onSyncProgress?: (e: SyncProgressEvent) => void;
  }
): Promise<unknown> {
  if (name === "trigger_whoop_sync") {
    return handleTriggerWhoopSync(
      options.userId,
      options.turnState,
      options.signal,
      options.onSyncProgress,
    );
  }

  const { start_date: startDate, end_date: endDate } = parseDateRangeInput(input);

  switch (name) {
    case "query_recovery":
      return getRecoveryRange(options.userId, startDate, endDate);
    case "query_sleep":
      return getSleepRange(options.userId, startDate, endDate);
    case "query_strain":
      return getStrainRange(options.userId, startDate, endDate);
    case "query_workouts": {
      const result = getWorkoutsRange(options.userId, startDate, endDate);
      // Resolve the user's IANA tz once per call; fall back to UTC if unset
      // (new users pre-/welcome haven't captured a tz). UTC keeps the field
      // populated and parseable instead of silently dropping it.
      const tz = getUserSettings(options.userId)?.tz ?? "UTC";
      const rows: WorkoutRow[] = result.rows.map((r) => ({
        ...r,
        start_local: formatLocalIso(r.start_utc, tz),
        end_local: formatLocalIso(r.end_utc, tz),
      }));
      const _meta: {
        truncated: boolean;
        total_count: number;
        returned: number;
        note?: string;
      } = {
        truncated: result.truncated,
        total_count: result.total_count,
        returned: rows.length,
      };
      if (result.truncated) {
        _meta.note = `Showing the ${rows.length} most recent workouts in this range. Total in range: ${result.total_count}.`;
      }
      return { rows, _meta };
    }
    case "query_naps":
      return getNaps(options.userId, startDate, endDate);
    case "query_journal":
      // journal has no user_id today — out of scope for Phase D, addressed
      // in Phase E follow-up. Reads remain unscoped.
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
  /** Tool response payload, captured so /logs detail view can render it.
   *  Truncated to ~12KB (JSON-stringified) when persisted via
   *  `chatLogToolSummaries` to keep chat_logs.details under any practical
   *  size cap. */
  response?: unknown;
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
  /**
   * Mid-tool progress for long-running tools. Producer policy lives in
   * `executeToolResult` — see the sync forwarder there. `query_*` tools
   * resolve in <500ms and don't get a progress channel.
   */
  onToolProgress?: (event: {
    tool: string;
    stage: string;
    message?: string;
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

export type ExecuteToolResultOptions = {
  /**
   * Owner of the Whoop integration. Threaded down to `executeTool` →
   * `handleTriggerWhoopSync` → `runWhoopSync` so the coach acts on behalf
   * of the signed-in user, not the legacy bootstrap id.
   */
  userId: number;
  turnState: ToolTurnState;
  progress?: ToolProgressHandlers;
  signal?: AbortSignal;
};

export async function executeToolResult(
  threadId: number,
  toolUse: ToolUseBlock,
  toolDetails: ToolDetail[],
  opts: ExecuteToolResultOptions
): Promise<ToolResultBlockParam> {
  const { progress, signal, turnState, userId } = opts;
  const startMs = Date.now();
  progress?.onToolUseStart?.({ name: toolUse.name, input: toolUse.input });
  console.info("[coach] tool_call", {
    thread_id: threadId,
    name: toolUse.name,
  });

  // Build a sync-progress forwarder only for trigger_whoop_sync; other tools
  // don't emit progress and don't need the closure allocated.
  const onSyncProgress =
    toolUse.name === "trigger_whoop_sync" && progress?.onToolProgress
      ? (e: SyncProgressEvent) =>
          progress.onToolProgress!({
            tool: "trigger_whoop_sync",
            stage: e.stage,
            ...(e.message ? { message: e.message } : {}),
          })
      : undefined;

  let result: unknown;
  try {
    result = await executeTool(toolUse.name, toolUse.input, {
      userId,
      turnState,
      signal,
      onSyncProgress,
    });
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
    response: result,
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

// Cap on the persisted response payload per tool call (JSON chars). Past this,
// emit a `_truncated` marker with a 5-row preview when the shape allows it.
const TOOL_RESPONSE_MAX_CHARS = 12_000;

function captureToolResponse(response: unknown): unknown {
  if (response === undefined) return undefined;
  let serialized: string;
  try {
    serialized = JSON.stringify(response);
  } catch {
    return { _truncated: true, reason: "non_serializable" };
  }
  if (serialized.length <= TOOL_RESPONSE_MAX_CHARS) {
    return response;
  }
  if (Array.isArray(response)) {
    return {
      _truncated: true,
      total_count: response.length,
      preview: response.slice(0, 5),
    };
  }
  // query_workouts wraps rows in `{ rows, _meta }`. Preserve the preview
  // shape so the UI doesn't fall through to a near-empty JSON viewer.
  if (
    typeof response === "object" &&
    response !== null &&
    !Array.isArray(response) &&
    Array.isArray((response as { rows?: unknown }).rows)
  ) {
    const rows = (response as { rows: unknown[] }).rows;
    const meta = (response as { _meta?: { total_count?: unknown } })._meta;
    const totalCount =
      meta && typeof meta.total_count === "number" ? meta.total_count : rows.length;
    return {
      _truncated: true,
      total_count: totalCount,
      preview: rows.slice(0, 5),
    };
  }
  return {
    _truncated: true,
    size_chars: serialized.length,
  };
}

export function chatLogToolSummaries(toolDetails: ToolDetail[]) {
  return toolDetails.map(
    ({ name, input, duration_ms, rows, status, error, response }) => ({
      name,
      input,
      duration_ms,
      rows,
      status,
      ...(error ? { error: error.slice(0, 200) } : {}),
      ...(response === undefined ? {} : { response: captureToolResponse(response) }),
    })
  );
}
