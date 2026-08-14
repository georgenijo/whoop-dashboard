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
  getWorkoutPlans,
  getWorkoutsRange,
  saveWorkoutPlan,
} from "@/lib/db";
import type {
  Intensity,
  PlanDay,
  PlanExercise,
  PlanStructure,
  SaveWorkoutPlanInput,
  WorkoutPlan,
  WorkoutRow,
} from "@/lib/db";
import { createHash } from "node:crypto";
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
  | "query_daily_snapshot"
  | "query_workout_plans"
  | "save_workout_plan"
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

// `save_workout_plan` is the FIRST write tool. Its input_schema is structured
// (nested arrays/objects), unlike the date-range / empty-input read tools.
// Anthropic strict tools support nested `array` + `object` with their own
// `required` / `additionalProperties:false`, so we type the schema loosely as
// a Tool and rely on `validateSavePlanInput` for runtime enforcement.
type StructuredToolSchema = Tool & {
  name: CoachToolName;
  description: string;
  strict: true;
};

type ToolSchema =
  | DateRangeToolSchema
  | EmptyInputToolSchema
  | StructuredToolSchema;

const INTENSITY_VALUES = ["hard", "moderate", "reduced", "rest"] as const;

const SAVE_WORKOUT_PLAN_SCHEMA: StructuredToolSchema["input_schema"] = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Short plan name, e.g. 'Push / Pull / Legs'.",
    },
    tag: {
      type: "string",
      description:
        "Optional one-word category shown as a chip, e.g. 'Recovery-tuned', 'Strength', 'Aerobic'.",
    },
    description: {
      type: "string",
      description: "Optional one-line summary of the plan.",
    },
    why: {
      type: "string",
      description:
        "Optional rationale tying the prescription to the user's recovery / HRV trend. Surfaced as a 'Why this prescription' note on the Plans page.",
    },
    make_active: {
      type: "boolean",
      description:
        "When true, this plan becomes the user's single active plan and any other active plan is deactivated. Default false.",
    },
    days: {
      type: "array",
      description: "Ordered training days. At least one day is required.",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Day name, e.g. 'Push', 'Pull', 'Legs', 'Rest'.",
          },
          focus: {
            type: "string",
            description:
              "Optional muscle-group focus, e.g. 'Chest · Shoulders · Triceps'.",
          },
          intensity: {
            type: "string",
            enum: INTENSITY_VALUES as unknown as string[],
            description:
              "Recovery-scaled intensity for the day. One of: hard, moderate, reduced, rest.",
          },
          exercises: {
            type: "array",
            description:
              "Exercises for the day. Required and non-empty for non-rest days; may be empty for a pure rest day.",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "Exercise name, e.g. 'Barbell Bench Press'.",
                },
                scheme: {
                  type: "string",
                  description: "Sets × reps scheme, e.g. '4 × 5' or '3 × 12'.",
                },
                note: {
                  type: "string",
                  description: "Optional cue, e.g. '↓load' or 'tempo 3-1-1'.",
                },
              },
              required: ["name", "scheme"],
              additionalProperties: false,
            },
          },
        },
        required: ["name", "intensity", "exercises"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "days"],
  additionalProperties: false,
};

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
  },
  {
    name: "query_daily_snapshot",
    description:
      "Bundled fetch of recovery + sleep + strain + workouts for a date range, in one tool call. Returns the same row shapes as the individual query_* tools under the keys recovery, sleep, strain, workouts (workouts is { rows, _meta } matching query_workouts). Naps and journal are NOT included — use query_naps / query_journal directly when those are the question. Use this for broad 'how am I doing' / daily-status questions to avoid 4 round-trips; use the single-domain tools when the user asks about exactly one area.",
    input_schema: DATE_RANGE_SCHEMA,
    strict: true,
    cache_control: { type: "ephemeral", ttl: "1h" },
  },
  {
    name: "query_workout_plans",
    description:
      "List the user's saved workout plans (Coach-authored, recovery-tuned). " +
      "Returns each plan's id, title, tag, description, created_by, is_active, " +
      "the structured plan (days -> exercises with scheme + intensity, plus an " +
      "optional 'why' rationale), an optional recovery_context snapshot, and " +
      "ISO-8601 timestamps. Use before save_workout_plan to reference or update " +
      "an existing plan instead of creating a duplicate.",
    input_schema: EMPTY_INPUT_SCHEMA,
    strict: true,
  },
  {
    name: "save_workout_plan",
    description:
      "Author and persist a structured, recovery-tuned workout plan for the " +
      "user. This is a WRITE — it saves immediately (no confirmation step) and " +
      "the new plan appears on the user's Plans page. Provide a title, an " +
      "ordered list of training days (each with an intensity scaled to the " +
      "user's recovery: hard / moderate / reduced / rest, and a list of " +
      "exercises with set x rep schemes), and optionally a tag, description, " +
      "and a 'why' note explaining how the prescription maps to their recovery " +
      "/ HRV trend. Set make_active:true to make this the user's active plan " +
      "(deactivates any other active plan). Returns the saved plan. Re-submitting " +
      "an identical plan in the same turn is a no-op (returns the already-saved id).",
    input_schema: SAVE_WORKOUT_PLAN_SCHEMA,
    strict: true,
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

// Bundle the workouts payload (rows with local-time fields + _meta) so
// query_workouts and query_daily_snapshot return byte-identical shapes
// for that key. Pulled out of the executeTool switch so the snapshot
// branch doesn't duplicate the tz lookup + row mapping inline.
function buildWorkoutsPayload(
  userId: number,
  startDate: string,
  endDate: string,
): { rows: WorkoutRow[]; _meta: { truncated: boolean; total_count: number; returned: number; note?: string } } {
  const result = getWorkoutsRange(userId, startDate, endDate);
  // Resolve the user's IANA tz once per call; fall back to UTC if unset
  // (new users pre-/welcome haven't captured a tz). UTC keeps the field
  // populated and parseable instead of silently dropping it.
  const tz = getUserSettings(userId)?.tz ?? "UTC";
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
 * Per-turn state shared across `executeTool` calls.
 *   - `syncAttempts`: hard-caps `trigger_whoop_sync` at one actual sync attempt
 *     per chat turn (cooldown skips don't count).
 *   - `savedPlanHashes`: within-turn idempotency for `save_workout_plan`. Maps
 *     a normalized-plan content hash -> the plan id that was written for it, so
 *     a model re-submitting an identical plan in the same turn gets the
 *     existing id back with `{ deduped: true }` instead of a duplicate row.
 */
export type ToolTurnState = {
  syncAttempts: number;
  savedPlanHashes: Map<string, number>;
};

export function newToolTurnState(): ToolTurnState {
  return { syncAttempts: 0, savedPlanHashes: new Map() };
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
  //
  // Scoped to `userId` (issue #494). Reading it globally leaked another
  // tenant's last-sync timestamp straight into the model's context, and let
  // one tenant's sync lock every other tenant out of syncing for the window.
  const lastOk = getLastSuccessfulSyncAt(userId);
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
        user_id: userId,
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
        user_id: userId,
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

// ---------------------------------------------------------------------------
// save_workout_plan — the coach's first WRITE tool.
//
// SEMANTICS (locked, issue #421):
//   - Immediate write: no pre-write confirmation gate. The "Saved" chip in the
//     UI is post-hoc, driven by the existing tool_use_end SSE event — there is
//     no separate confirm round-trip.
//   - Counts as a normal tool round-trip against MAX_TOOL_ITERATIONS (no
//     exemption — unlike the sync cap, which is a separate per-turn counter).
//   - Within-turn idempotency: the normalized plan is content-hashed; a
//     re-submission of the same plan in the same turn returns the already-saved
//     id with `{ deduped: true }` instead of inserting a duplicate.
//   - Input is validated thoroughly here and `ToolInputError` is thrown on a
//     bad shape so the model gets a structured error it can correct.
// ---------------------------------------------------------------------------

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function validateExercise(value: unknown, dayIdx: number, exIdx: number): PlanExercise {
  if (!isRecord(value)) {
    throw new ToolInputError("Each exercise must be an object.", {
      code: "invalid_exercise",
      day_index: dayIdx,
      exercise_index: exIdx,
      received: value,
    });
  }
  const name = asTrimmedString(value.name);
  const scheme = asTrimmedString(value.scheme);
  if (!name) {
    throw new ToolInputError("exercise.name is required and must be a non-empty string.", {
      code: "invalid_exercise_name",
      day_index: dayIdx,
      exercise_index: exIdx,
    });
  }
  if (!scheme) {
    throw new ToolInputError("exercise.scheme is required and must be a non-empty string.", {
      code: "invalid_exercise_scheme",
      day_index: dayIdx,
      exercise_index: exIdx,
    });
  }
  const note = asTrimmedString(value.note);
  return { name, scheme, ...(note ? { note } : {}) };
}

function validateDay(value: unknown, dayIdx: number): PlanDay {
  if (!isRecord(value)) {
    throw new ToolInputError("Each day must be an object.", {
      code: "invalid_day",
      day_index: dayIdx,
      received: value,
    });
  }
  const name = asTrimmedString(value.name);
  if (!name) {
    throw new ToolInputError("day.name is required and must be a non-empty string.", {
      code: "invalid_day_name",
      day_index: dayIdx,
    });
  }
  const intensity = value.intensity;
  if (
    typeof intensity !== "string" ||
    !(INTENSITY_VALUES as readonly string[]).includes(intensity)
  ) {
    throw new ToolInputError("day.intensity must be one of: hard, moderate, reduced, rest.", {
      code: "invalid_day_intensity",
      day_index: dayIdx,
      allowed: INTENSITY_VALUES,
      received: intensity,
    });
  }
  if (!Array.isArray(value.exercises)) {
    throw new ToolInputError("day.exercises must be an array.", {
      code: "invalid_day_exercises",
      day_index: dayIdx,
      received: value.exercises,
    });
  }
  // Non-rest days must have at least one exercise; a pure rest day may be empty.
  if (intensity !== "rest" && value.exercises.length === 0) {
    throw new ToolInputError("A non-rest day must have at least one exercise.", {
      code: "empty_day_exercises",
      day_index: dayIdx,
      intensity,
    });
  }
  const exercises = value.exercises.map((ex, i) => validateExercise(ex, dayIdx, i));
  const focus = asTrimmedString(value.focus);
  return {
    name,
    ...(focus ? { focus } : {}),
    intensity: intensity as Intensity,
    exercises,
  };
}

function validateSavePlanInput(input: unknown): SaveWorkoutPlanInput {
  if (!isRecord(input)) {
    throw new ToolInputError("save_workout_plan input must be an object.", {
      code: "invalid_input",
      received: input,
    });
  }
  const title = asTrimmedString(input.title);
  if (!title) {
    throw new ToolInputError("title is required and must be a non-empty string.", {
      code: "invalid_title",
      received: input.title,
    });
  }
  if (!Array.isArray(input.days) || input.days.length === 0) {
    throw new ToolInputError("days is required and must be a non-empty array.", {
      code: "invalid_days",
      received: input.days,
    });
  }
  const days = input.days.map((d, i) => validateDay(d, i));
  const why = asTrimmedString(input.why);
  const plan: PlanStructure = { days, ...(why ? { why } : {}) };

  if (input.make_active !== undefined && typeof input.make_active !== "boolean") {
    throw new ToolInputError("make_active must be a boolean when provided.", {
      code: "invalid_make_active",
      received: input.make_active,
    });
  }

  return {
    title,
    ...(asTrimmedString(input.tag) ? { tag: asTrimmedString(input.tag) } : {}),
    ...(asTrimmedString(input.description)
      ? { description: asTrimmedString(input.description) }
      : {}),
    plan,
    make_active: input.make_active === true,
    created_by: "coach",
  };
}

/** Stable content hash of the normalized plan for within-turn dedup. Key off
 *  the fields that define plan identity — title + structure + active intent —
 *  so byte-identical re-submissions collide but genuinely different plans don't. */
function hashPlanInput(parsed: SaveWorkoutPlanInput): string {
  const canonical = JSON.stringify({
    title: parsed.title,
    tag: parsed.tag ?? null,
    description: parsed.description ?? null,
    plan: parsed.plan,
    make_active: parsed.make_active === true,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

type SavePlanToolResult =
  | { success: true; plan: WorkoutPlan }
  | { success: true; deduped: true; plan_id: number };

function handleSaveWorkoutPlan(
  userId: number,
  turnState: ToolTurnState,
  input: unknown,
): SavePlanToolResult {
  const parsed = validateSavePlanInput(input);
  const hash = hashPlanInput(parsed);

  // Within-turn idempotency: identical normalized plan already written this
  // turn → return the existing id, no second insert.
  const existingId = turnState.savedPlanHashes.get(hash);
  if (existingId !== undefined) {
    return { success: true, deduped: true, plan_id: existingId };
  }

  const saved = saveWorkoutPlan(userId, parsed);
  if (!saved) {
    throw new ToolInputError("Could not save the plan — the data store is unavailable.", {
      code: "persist_failed",
    });
  }
  turnState.savedPlanHashes.set(hash, saved.id);
  return { success: true, plan: saved };
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

  // Plan tools don't take a date range — handle them before parseDateRangeInput.
  if (name === "query_workout_plans") {
    return getWorkoutPlans(options.userId);
  }
  if (name === "save_workout_plan") {
    return handleSaveWorkoutPlan(options.userId, options.turnState, input);
  }

  const { start_date: startDate, end_date: endDate } = parseDateRangeInput(input);

  switch (name) {
    case "query_recovery":
      return getRecoveryRange(options.userId, startDate, endDate);
    case "query_sleep":
      return getSleepRange(options.userId, startDate, endDate);
    case "query_strain":
      return getStrainRange(options.userId, startDate, endDate);
    case "query_workouts":
      return buildWorkoutsPayload(options.userId, startDate, endDate);
    case "query_naps":
      return getNaps(options.userId, startDate, endDate);
    case "query_journal":
      return getJournalRange(options.userId, startDate, endDate);
    case "query_daily_snapshot":
      return {
        recovery: getRecoveryRange(options.userId, startDate, endDate),
        sleep: getSleepRange(options.userId, startDate, endDate),
        strain: getStrainRange(options.userId, startDate, endDate),
        workouts: buildWorkoutsPayload(options.userId, startDate, endDate),
      };
    default:
      throw new ToolInputError(`Unknown tool: ${name}`, {
        code: "unknown_tool",
        tool: name,
        available_tools: TOOLS.map((tool) => tool.name),
      });
  }
}

export type ToolDetail = {
  id: string;
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
  onToolUseStart?: (event: { id: string; name: string; input: unknown }) => void;
  onToolUseEnd?: (event: {
    id: string;
    name: string;
    duration_ms: number;
    rows: number | null;
    status: "ok" | "error";
    error?: string;
    response?: unknown;
  }) => void;
  /**
   * Mid-tool progress for long-running tools. Producer policy lives in
   * `executeToolResult` — see the sync forwarder there. `query_*` tools
   * resolve in <500ms and don't get a progress channel.
   */
  onToolProgress?: (event: {
    id: string;
    tool: string;
    stage: string;
    message?: string;
  }) => void;
};

// Best-effort row count for the /logs UI. Plain arrays report length;
// query_workouts and query_daily_snapshot wrap rows in containers, so
// peek inside instead of recording null.
function countRows(result: unknown): number | null {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (Array.isArray(obj.rows)) return obj.rows.length;
    let total = 0;
    let saw = false;
    for (const key of ["recovery", "sleep", "strain", "workouts"]) {
      const value = obj[key];
      if (Array.isArray(value)) {
        total += value.length;
        saw = true;
      } else if (value && typeof value === "object" && Array.isArray((value as { rows?: unknown }).rows)) {
        total += ((value as { rows: unknown[] }).rows).length;
        saw = true;
      }
    }
    if (saw) return total;
  }
  return null;
}

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
  progress?.onToolUseStart?.({
    id: toolUse.id,
    name: toolUse.name,
    input: redactToolPayload(toolUse.input),
  });
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
            id: toolUse.id,
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
      id: toolUse.id,
      name: toolUse.name,
      input: toolUse.input,
      duration_ms: durationMs,
      rows: null,
      status: "error",
      error,
    });
    progress?.onToolUseEnd?.({
      id: toolUse.id,
      name: toolUse.name,
      duration_ms: durationMs,
      rows: null,
      status: "error",
      error,
      response: { error },
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
  const rows = countRows(result);
  toolDetails.push({
    id: toolUse.id,
    name: toolUse.name,
    input: toolUse.input,
    duration_ms: durationMs,
    rows,
    status: "ok",
    response: result,
  });
  progress?.onToolUseEnd?.({
    id: toolUse.id,
    name: toolUse.name,
    duration_ms: durationMs,
    rows,
    status: "ok",
    response: captureToolResponse(result),
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
const SENSITIVE_KEY = /^(?:authorization|cookie|api[_-]?key|.*token.*|.*secret.*)$/i;

export function redactToolPayload(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((item) => redactToolPayload(item, seen));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactToolPayload(item, seen),
      ]),
    );
  }
  return value;
}

export function captureToolResponse(response: unknown): unknown {
  if (response === undefined) return undefined;
  const safeResponse = redactToolPayload(response);
  let serialized: string;
  try {
    serialized = JSON.stringify(safeResponse);
  } catch {
    return { _truncated: true, reason: "non_serializable" };
  }
  if (serialized.length <= TOOL_RESPONSE_MAX_CHARS) {
    return safeResponse;
  }
  if (Array.isArray(safeResponse)) {
    return {
      _truncated: true,
      total_count: safeResponse.length,
      preview: safeResponse.slice(0, 5),
    };
  }
  // query_workouts wraps rows in `{ rows, _meta }`. Preserve the preview
  // shape so the UI doesn't fall through to a near-empty JSON viewer.
  if (
    typeof safeResponse === "object" &&
    safeResponse !== null &&
    !Array.isArray(safeResponse) &&
    Array.isArray((safeResponse as { rows?: unknown }).rows)
  ) {
    const rows = (safeResponse as { rows: unknown[] }).rows;
    const meta = (safeResponse as { _meta?: { total_count?: unknown } })._meta;
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
    ({ id, name, input, duration_ms, rows, status, error, response }) => ({
      id,
      name,
      input: redactToolPayload(input ?? {}),
      duration_ms,
      rows,
      status,
      ...(error ? { error: error.slice(0, 200) } : {}),
      ...(response === undefined ? {} : { response: captureToolResponse(response) }),
    })
  );
}
