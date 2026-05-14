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
}));

vi.mock("@/lib/sync", () => ({
  runWhoopSync: vi.fn(),
  SYNC_COOLDOWN_MS: 5 * 60 * 1000,
}));

import {
  addSyncLog,
  getLastSuccessfulSyncAt,
  getUserSettings,
  getWorkoutsRange,
} from "@/lib/db";
import { runWhoopSync } from "@/lib/sync";
import { executeTool, newToolTurnState } from "./tools";

const addSyncLogMock = vi.mocked(addSyncLog);
const getLastSuccessfulSyncAtMock = vi.mocked(getLastSuccessfulSyncAt);
const getUserSettingsMock = vi.mocked(getUserSettings);
const getWorkoutsRangeMock = vi.mocked(getWorkoutsRange);
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
      cooldown_seconds: number;
      next_sync_allowed_at: string;
    };

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/cooldown/i);
    expect(result.last_sync_at).toBe(lastOk.toISOString());
    expect(result.cooldown_seconds).toBe(300);
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
