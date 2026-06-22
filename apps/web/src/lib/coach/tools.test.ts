import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncResult } from "@/lib/sync";

vi.mock("server-only", () => ({}));

// Stub out @/lib/db imports used by tools.ts. The query_* helpers aren't
// exercised here, only addSyncLog + getLastSuccessfulSyncAt.
vi.mock("@/lib/db", () => ({
  addSyncLog: vi.fn(),
  getLastSuccessfulSyncAt: vi.fn(),
  // Unused but re-exported by tools.ts at module load.
  getJournalRange: vi.fn(),
  getNaps: vi.fn(),
  getRecoveryRange: vi.fn(),
  getSleepRange: vi.fn(),
  getStrainRange: vi.fn(),
  getUserSettings: vi.fn(),
  getWorkoutsRange: vi.fn(),
  getWorkoutPlans: vi.fn(),
  saveWorkoutPlan: vi.fn(),
}));

vi.mock("@/lib/sync", () => ({
  runWhoopSync: vi.fn(),
  SYNC_COOLDOWN_MS: 5 * 60 * 1000,
}));

import {
  addSyncLog,
  getLastSuccessfulSyncAt,
  getUserSettings,
  getWorkoutPlans,
  getWorkoutsRange,
  saveWorkoutPlan,
  type WorkoutPlan,
} from "@/lib/db";
import { runWhoopSync } from "@/lib/sync";
import { chatLogToolSummaries, executeTool, newToolTurnState, type ToolDetail } from "./tools";

const addSyncLogMock = vi.mocked(addSyncLog);
const getLastSuccessfulSyncAtMock = vi.mocked(getLastSuccessfulSyncAt);
const getUserSettingsMock = vi.mocked(getUserSettings);
const getWorkoutsRangeMock = vi.mocked(getWorkoutsRange);
const getWorkoutPlansMock = vi.mocked(getWorkoutPlans);
const saveWorkoutPlanMock = vi.mocked(saveWorkoutPlan);
const runWhoopSyncMock = vi.mocked(runWhoopSync);

function makeSuccessSyncResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    success: true,
    latest_recovery_date: "2026-05-08",
    latest_sleep_date: "2026-05-07",
    latest_strain_date: "2026-05-08",
    rows_inserted: { recovery: 2, sleep: 1, cycles: 1, workouts: 0 },
    fetched_counts: { recovery: 2, sleep: 1, cycles: 1, workouts: 0 },
    details: {
      window_days: 7,
      fetch_ms: 1234,
      sync_db_ms: 56,
      body_ms: 12,
      fetch_breakdown: {},
      page_counts: {},
      summary_dates: 1,
    },
    ...overrides,
  };
}

function makeErrorSyncResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    success: false,
    error: "upstream 503: temporary failure",
    latest_recovery_date: null,
    latest_sleep_date: null,
    latest_strain_date: null,
    rows_inserted: { recovery: 0, sleep: 0, cycles: 0, workouts: 0 },
    fetched_counts: { recovery: 0, sleep: 0, cycles: 0, workouts: 0 },
    details: {
      window_days: 7,
      fetch_ms: 0,
      sync_db_ms: 0,
      body_ms: 0,
      fetch_breakdown: {},
      page_counts: {},
      summary_dates: 0,
    },
    ...overrides,
  };
}

describe("trigger_whoop_sync tool", () => {
  beforeEach(() => {
    addSyncLogMock.mockReset();
    getLastSuccessfulSyncAtMock.mockReset();
    runWhoopSyncMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("short-circuits with skipped=true when last sync is within cooldown window", async () => {
    const lastOk = new Date(Date.now() - 60_000); // 1 minute ago
    getLastSuccessfulSyncAtMock.mockReturnValue(lastOk);
    const turnState = newToolTurnState();

    const result = (await executeTool("trigger_whoop_sync", null, { userId: 1, turnState })) as {
      success: boolean;
      skipped: boolean;
      reason: string;
      last_sync_at: string;
      cooldown_window_seconds: number;
      next_sync_allowed_at: string;
    };

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/cooldown/i);
    expect(result.last_sync_at).toBe(lastOk.toISOString());
    expect(result.cooldown_window_seconds).toBe(300);
    expect(result.next_sync_allowed_at).toBe(
      new Date(lastOk.getTime() + 5 * 60 * 1000).toISOString(),
    );
    expect(runWhoopSyncMock).not.toHaveBeenCalled();
    expect(addSyncLogMock).not.toHaveBeenCalled();
    // Cooldown skips don't count toward the per-turn cap.
    expect(turnState.syncAttempts).toBe(0);
  });

  it("writes a sync_logs row with source=coach status=ok on a successful sync", async () => {
    getLastSuccessfulSyncAtMock.mockReturnValue(null);
    const syncResult = makeSuccessSyncResult();
    runWhoopSyncMock.mockResolvedValue(syncResult);
    const turnState = newToolTurnState();

    const result = await executeTool("trigger_whoop_sync", null, { userId: 1, turnState });

    expect(result).toBe(syncResult);
    expect(runWhoopSyncMock).toHaveBeenCalledTimes(1);
    expect(addSyncLogMock).toHaveBeenCalledTimes(1);
    const arg = addSyncLogMock.mock.calls[0][0];
    expect(arg.source).toBe("coach");
    expect(arg.status).toBe("ok");
    expect(arg.error_message).toBeNull();
    expect(arg.recovery_count).toBe(2);
    expect(arg.sleep_count).toBe(1);
    expect(arg.workouts_count).toBe(0);
    expect(turnState.syncAttempts).toBe(1);
  });

  it("writes a sync_logs row with status=error and an error message when runWhoopSync fails", async () => {
    getLastSuccessfulSyncAtMock.mockReturnValue(null);
    const syncResult = makeErrorSyncResult();
    runWhoopSyncMock.mockResolvedValue(syncResult);
    const turnState = newToolTurnState();

    const result = await executeTool("trigger_whoop_sync", null, { userId: 1, turnState });

    expect(result).toBe(syncResult);
    expect(addSyncLogMock).toHaveBeenCalledTimes(1);
    const arg = addSyncLogMock.mock.calls[0][0];
    expect(arg.source).toBe("coach");
    expect(arg.status).toBe("error");
    expect(arg.error_message).toBe("upstream 503: temporary failure");
    // Real attempts (success or failure) count toward the per-turn cap.
    expect(turnState.syncAttempts).toBe(1);
  });

  it("returns already_synced=true on the second call in the same turn without invoking runWhoopSync again", async () => {
    getLastSuccessfulSyncAtMock.mockReturnValue(null);
    runWhoopSyncMock.mockResolvedValue(makeSuccessSyncResult());
    const turnState = newToolTurnState();

    const first = await executeTool("trigger_whoop_sync", null, { userId: 1, turnState });
    expect((first as { success: boolean }).success).toBe(true);
    expect(runWhoopSyncMock).toHaveBeenCalledTimes(1);

    const second = (await executeTool("trigger_whoop_sync", null, { userId: 1, turnState })) as {
      success: boolean;
      already_synced: boolean;
      error: string;
    };

    expect(second.success).toBe(false);
    expect(second.already_synced).toBe(true);
    expect(second.error).toMatch(/already attempted/i);
    expect(runWhoopSyncMock).toHaveBeenCalledTimes(1); // unchanged
  });

  it("still returns the SyncResult to the model when addSyncLog throws", async () => {
    getLastSuccessfulSyncAtMock.mockReturnValue(null);
    const syncResult = makeSuccessSyncResult();
    runWhoopSyncMock.mockResolvedValue(syncResult);
    addSyncLogMock.mockImplementation(() => {
      throw new Error("database is locked");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const turnState = newToolTurnState();

    const result = await executeTool("trigger_whoop_sync", null, { userId: 1, turnState });

    expect(result).toBe(syncResult);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[coach] sync_log_write_failed",
      expect.objectContaining({ error: "database is locked", sync_success: true })
    );
  });
});

// Regression for issue #347: the coach claimed workout timestamps were
// unavailable when query_workouts had silently omitted them. start_utc/
// end_utc come straight from json_extract; start_local/end_local are
// derived at the coach-tool boundary using the user's IANA tz.
describe("query_workouts tool — timestamps", () => {
  beforeEach(() => {
    getUserSettingsMock.mockReset();
    getWorkoutsRangeMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("layers start_local/end_local using the user's IANA tz from user_settings", async () => {
    getUserSettingsMock.mockReturnValue({
      user_id: 1,
      anthropic_key: null,
      model_pref: null,
      timezone: null,
      monthly_token_cap: null,
      coach_goals: null,
      onboarded_at: null,
      tz: "America/New_York",
      updated_at: "2026-05-14T00:00:00.000Z",
    });
    getWorkoutsRangeMock.mockReturnValue({
      rows: [
        {
          id: "w-1",
          date: "2026-05-13",
          sport: "running",
          duration_sec: 2700,
          avg_hr: 150,
          max_hr: 170,
          strain: 12.5,
          kilojoule: 1500,
          distance_m: 5000,
          zone_0_ms: 0,
          zone_1_ms: 0,
          zone_2_ms: 0,
          zone_3_ms: 0,
          zone_4_ms: 0,
          zone_5_ms: 0,
          start_utc: "2026-05-14T01:30:00.000Z",
          end_utc: "2026-05-14T02:15:00.000Z",
        },
      ],
      truncated: false,
      total_count: 1,
    });

    const result = (await executeTool(
      "query_workouts",
      { start_date: "2026-05-13", end_date: "2026-05-13" },
      { userId: 1, turnState: newToolTurnState() },
    )) as { rows: Array<Record<string, unknown>> };

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.start_utc).toBe("2026-05-14T01:30:00.000Z");
    expect(row.end_utc).toBe("2026-05-14T02:15:00.000Z");
    // 01:30Z in America/New_York is 21:30 the previous local day (EDT, -04:00).
    expect(row.start_local).toBe("2026-05-13T21:30:00");
    expect(row.end_local).toBe("2026-05-13T22:15:00");
  });

  it("falls back to UTC when the user has no tz captured yet", async () => {
    getUserSettingsMock.mockReturnValue(null);
    getWorkoutsRangeMock.mockReturnValue({
      rows: [
        {
          id: "w-2",
          date: "2026-05-13",
          sport: "running",
          duration_sec: 1800,
          avg_hr: 140,
          max_hr: 160,
          strain: 10,
          kilojoule: 1000,
          distance_m: null,
          zone_0_ms: 0,
          zone_1_ms: 0,
          zone_2_ms: 0,
          zone_3_ms: 0,
          zone_4_ms: 0,
          zone_5_ms: 0,
          start_utc: "2026-05-13T12:00:00.000Z",
          end_utc: "2026-05-13T12:30:00.000Z",
        },
      ],
      truncated: false,
      total_count: 1,
    });

    const result = (await executeTool(
      "query_workouts",
      { start_date: "2026-05-13", end_date: "2026-05-13" },
      { userId: 1, turnState: newToolTurnState() },
    )) as { rows: Array<Record<string, unknown>> };

    expect(result.rows[0].start_local).toBe("2026-05-13T12:00:00");
    expect(result.rows[0].end_local).toBe("2026-05-13T12:30:00");
  });

  it("returns null start_local/end_local when start_utc/end_utc are missing", async () => {
    getUserSettingsMock.mockReturnValue(null);
    getWorkoutsRangeMock.mockReturnValue({
      rows: [
        {
          id: "w-3",
          date: "2026-05-13",
          sport: "yoga",
          duration_sec: 1800,
          avg_hr: 90,
          max_hr: 110,
          strain: 4,
          kilojoule: 400,
          distance_m: null,
          zone_0_ms: 0,
          zone_1_ms: 0,
          zone_2_ms: 0,
          zone_3_ms: 0,
          zone_4_ms: 0,
          zone_5_ms: 0,
          start_utc: null,
          end_utc: null,
        },
      ],
      truncated: false,
      total_count: 1,
    });

    const result = (await executeTool(
      "query_workouts",
      { start_date: "2026-05-13", end_date: "2026-05-13" },
      { userId: 1, turnState: newToolTurnState() },
    )) as { rows: Array<Record<string, unknown>> };

    expect(result.rows[0].start_local).toBeNull();
    expect(result.rows[0].end_local).toBeNull();
  });
});

describe("chatLogToolSummaries", () => {
  it("passes a small array response through verbatim", () => {
    const rows = [{ date: "2026-05-12", recovery_score: 67 }];
    const detail: ToolDetail = {
      name: "query_recovery",
      input: { start_date: "2026-05-12", end_date: "2026-05-12" },
      duration_ms: 4,
      rows: 1,
      status: "ok",
      response: rows,
    };

    const [summary] = chatLogToolSummaries([detail]);

    expect(summary.response).toEqual(rows);
  });

  it("replaces oversized array responses with a 5-row preview marker", () => {
    // 200 rows × ~80 chars/row sails past the 12KB cap.
    const rows = Array.from({ length: 200 }, (_, i) => ({
      date: `2026-${String((i % 12) + 1).padStart(2, "0")}-01`,
      recovery_score: i,
      hrv: 50 + i,
      rhr: 45 + (i % 20),
      spo2: 96.5,
      skin_temp: 33.4,
      raw: { score: { recovery_score: i }, note: "padded".repeat(10) },
    }));
    const detail: ToolDetail = {
      name: "query_recovery",
      input: { start_date: "2026-01-01", end_date: "2026-12-31" },
      duration_ms: 12,
      rows: rows.length,
      status: "ok",
      response: rows,
    };

    const [summary] = chatLogToolSummaries([detail]);

    expect(summary.response).toMatchObject({
      _truncated: true,
      total_count: 200,
    });
    const preview = (summary.response as { preview: unknown[] }).preview;
    expect(Array.isArray(preview)).toBe(true);
    expect(preview).toHaveLength(5);
  });

  it("omits the response key entirely when the ToolDetail has no response", () => {
    const detail: ToolDetail = {
      name: "query_recovery",
      input: {},
      duration_ms: 1,
      rows: null,
      status: "error",
      error: "boom",
    };

    const [summary] = chatLogToolSummaries([detail]);

    expect(summary).not.toHaveProperty("response");
    expect(summary.error).toBe("boom");
  });
});

describe("save_workout_plan tool", () => {
  beforeEach(() => {
    saveWorkoutPlanMock.mockReset();
    getWorkoutPlansMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const validInput = {
    title: "Push / Pull / Legs",
    tag: "Recovery-tuned",
    description: "Auto-scales load to daily recovery.",
    why: "HRV trend up +8% so volume bumped a set.",
    make_active: true,
    days: [
      {
        name: "Push",
        focus: "Chest · Shoulders · Triceps",
        intensity: "hard",
        exercises: [
          { name: "Barbell Bench Press", scheme: "4 × 5" },
          { name: "Overhead Press", scheme: "4 × 6", note: "tempo" },
        ],
      },
      {
        name: "Rest",
        intensity: "rest",
        exercises: [],
      },
    ],
  };

  function makeStoredPlan(overrides: Partial<WorkoutPlan> = {}): WorkoutPlan {
    return {
      id: 42,
      title: "Push / Pull / Legs",
      tag: "Recovery-tuned",
      description: "Auto-scales load to daily recovery.",
      created_by: "coach",
      is_active: true,
      plan: {
        days: [
          {
            name: "Push",
            focus: "Chest · Shoulders · Triceps",
            intensity: "hard",
            exercises: [
              { name: "Barbell Bench Press", scheme: "4 × 5" },
              { name: "Overhead Press", scheme: "4 × 6", note: "tempo" },
            ],
          },
          { name: "Rest", intensity: "rest", exercises: [] },
        ],
        why: "HRV trend up +8% so volume bumped a set.",
      },
      created_at: "2026-06-21T14:00:00.000Z",
      updated_at: "2026-06-21T14:00:00.000Z",
      ...overrides,
    };
  }

  it("validates input, writes a row, and returns the stored plan", async () => {
    const stored = makeStoredPlan();
    saveWorkoutPlanMock.mockReturnValue(stored);
    const turnState = newToolTurnState();

    const result = (await executeTool("save_workout_plan", validInput, {
      userId: 1,
      turnState,
    })) as { success: true; plan: WorkoutPlan };

    expect(saveWorkoutPlanMock).toHaveBeenCalledTimes(1);
    const [userIdArg, inputArg] = saveWorkoutPlanMock.mock.calls[0];
    expect(userIdArg).toBe(1);
    // Normalized into the SaveWorkoutPlanInput shape: why folded into plan,
    // created_by stamped, make_active carried through.
    expect(inputArg.title).toBe("Push / Pull / Legs");
    expect(inputArg.make_active).toBe(true);
    expect(inputArg.created_by).toBe("coach");
    expect(inputArg.plan.why).toBe("HRV trend up +8% so volume bumped a set.");
    expect(inputArg.plan.days).toHaveLength(2);

    expect(result.success).toBe(true);
    expect(result.plan).toEqual(stored);
  });

  it("dedupes an identical resubmission within the same turn", async () => {
    saveWorkoutPlanMock.mockReturnValue(makeStoredPlan());
    const turnState = newToolTurnState();

    const first = (await executeTool("save_workout_plan", validInput, {
      userId: 1,
      turnState,
    })) as { success: true; plan: WorkoutPlan };
    expect(first.plan.id).toBe(42);

    const second = (await executeTool("save_workout_plan", validInput, {
      userId: 1,
      turnState,
    })) as { success: true; deduped: true; plan_id: number };

    // Second identical submit must NOT insert again.
    expect(saveWorkoutPlanMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ success: true, deduped: true, plan_id: 42 });
  });

  it("throws ToolInputError on missing title", async () => {
    const turnState = newToolTurnState();
    await expect(
      executeTool(
        "save_workout_plan",
        { ...validInput, title: "  " },
        { userId: 1, turnState },
      ),
    ).rejects.toThrow(/title is required/i);
    expect(saveWorkoutPlanMock).not.toHaveBeenCalled();
  });

  it("throws ToolInputError on an invalid intensity", async () => {
    const turnState = newToolTurnState();
    await expect(
      executeTool(
        "save_workout_plan",
        {
          title: "Bad",
          days: [{ name: "Day", intensity: "easy", exercises: [{ name: "X", scheme: "1" }] }],
        },
        { userId: 1, turnState },
      ),
    ).rejects.toThrow(/intensity must be one of/i);
  });

  it("throws ToolInputError when a non-rest day has no exercises", async () => {
    const turnState = newToolTurnState();
    await expect(
      executeTool(
        "save_workout_plan",
        { title: "Bad", days: [{ name: "Push", intensity: "hard", exercises: [] }] },
        { userId: 1, turnState },
      ),
    ).rejects.toThrow(/non-rest day must have at least one exercise/i);
  });
});

describe("query_workout_plans tool", () => {
  beforeEach(() => {
    getWorkoutPlansMock.mockReset();
  });

  it("returns the user's plans", async () => {
    const plans: WorkoutPlan[] = [
      {
        id: 1,
        title: "PPL",
        created_by: "coach",
        is_active: true,
        plan: { days: [] },
        created_at: "2026-06-21T00:00:00.000Z",
        updated_at: "2026-06-21T00:00:00.000Z",
      },
    ];
    getWorkoutPlansMock.mockReturnValue(plans);

    const result = await executeTool("query_workout_plans", {}, {
      userId: 7,
      turnState: newToolTurnState(),
    });

    expect(getWorkoutPlansMock).toHaveBeenCalledWith(7);
    expect(result).toEqual(plans);
  });
});
