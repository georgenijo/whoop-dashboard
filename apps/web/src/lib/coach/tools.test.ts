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
  getWorkoutsRange: vi.fn(),
}));

vi.mock("@/lib/sync", () => ({
  runWhoopSync: vi.fn(),
  SYNC_COOLDOWN_MS: 5 * 60 * 1000,
}));

import { addSyncLog, getLastSuccessfulSyncAt } from "@/lib/db";
import { runWhoopSync } from "@/lib/sync";
import { executeTool, newToolTurnState } from "./tools";

const addSyncLogMock = vi.mocked(addSyncLog);
const getLastSuccessfulSyncAtMock = vi.mocked(getLastSuccessfulSyncAt);
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

    const result = (await executeTool("trigger_whoop_sync", null, { turnState })) as {
      success: boolean;
      skipped: boolean;
      reason: string;
      last_sync_at: string;
    };

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/cooldown/i);
    expect(result.last_sync_at).toBe(lastOk.toISOString());
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

    const result = await executeTool("trigger_whoop_sync", null, { turnState });

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

    const result = await executeTool("trigger_whoop_sync", null, { turnState });

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

    const first = await executeTool("trigger_whoop_sync", null, { turnState });
    expect((first as { success: boolean }).success).toBe(true);
    expect(runWhoopSyncMock).toHaveBeenCalledTimes(1);

    const second = (await executeTool("trigger_whoop_sync", null, { turnState })) as {
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

    const result = await executeTool("trigger_whoop_sync", null, { turnState });

    expect(result).toBe(syncResult);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[coach] sync_log_write_failed",
      expect.objectContaining({ error: "database is locked", sync_success: true })
    );
  });
});
