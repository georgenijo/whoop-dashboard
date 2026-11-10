// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/steps", () => ({ getStepsRange: vi.fn(() => []) }));
vi.mock("@/lib/db/user_settings", () => ({ getUserSettings: vi.fn(() => ({ tz: "America/New_York" })) }));
vi.mock("@/lib/whoop/upsert", () => ({ upsertCyclesAndRecompute: vi.fn() }));
vi.mock("@/lib/whoop/client", () => ({
  whoopGet: vi.fn(),
  WhoopAuthError: class WhoopAuthError extends Error {},
}));

import { getStepsRange, type StepsRow } from "@/lib/db/steps";
import { whoopGet, WhoopAuthError } from "@/lib/whoop/client";
import { upsertCyclesAndRecompute } from "@/lib/whoop/upsert";
import { querySteps } from "./steps";

const TZ = "America/New_York";

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

function storedRow(overrides: Partial<StepsRow> = {}): StepsRow {
  const now = new Date().toISOString();
  return {
    date: today(),
    steps: 1234,
    source: "whoop",
    updated_at: now,
    fetched_at: now,
    ...overrides,
  };
}

function staleRow(overrides: Partial<StepsRow> = {}): StepsRow {
  const fetchedAt = new Date(Date.now() - 16 * 60_000).toISOString();
  return storedRow({ updated_at: fetchedAt, fetched_at: fetchedAt, ...overrides });
}

function daysAgo(days: number): string {
  const date = new Date(Date.parse(`${today()}T00:00:00Z`) - days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

const getStepsRangeMock = vi.mocked(getStepsRange);
const whoopGetMock = vi.mocked(whoopGet);

beforeEach(() => {
  vi.clearAllMocks();
  getStepsRangeMock.mockReturnValue([]);
});

describe("native steps refresh", () => {
  it("serves a historical range without any WHOOP network call", async () => {
    const row = storedRow({ date: "2000-01-02" });
    getStepsRangeMock.mockReturnValue([row]);

    const result = await querySteps(2, "2000-01-01", "2000-01-05", "whoop");

    expect(whoopGetMock).not.toHaveBeenCalled();
    expect(upsertCyclesAndRecompute).not.toHaveBeenCalled();
    expect(result.rows).toEqual([row]);
    expect(result._meta).toMatchObject({ refresh: "not_requested", steps_stale: false });
  });

  it("serves fresh stored data for today without a WHOOP network call", async () => {
    const row = storedRow();
    getStepsRangeMock.mockReturnValue([row]);

    const result = await querySteps(2, today(), today(), "whoop");

    expect(whoopGetMock).not.toHaveBeenCalled();
    expect(result.rows).toEqual([row]);
    expect(result._meta).toMatchObject({ refresh: "not_requested", steps_stale: false });
  });

  it("treats updated_at as freshness when fetched_at is unavailable", async () => {
    const row = storedRow({ fetched_at: undefined });
    getStepsRangeMock.mockReturnValue([row]);

    const result = await querySteps(2, today(), today(), "whoop");

    expect(whoopGetMock).not.toHaveBeenCalled();
    expect(result._meta.refresh).toBe("not_requested");
  });

  it("refreshes stale data when the range includes today", async () => {
    const stale = staleRow();
    const refreshed = storedRow();
    getStepsRangeMock.mockReturnValueOnce([stale]).mockReturnValueOnce([refreshed]);
    const first = { id: 2, start: "2026-09-25T02:09:00Z", step_count: 25725 };
    const second = { id: 1, start: "2026-09-24T04:22:00Z", step_count: 19006 };
    whoopGetMock
      .mockResolvedValueOnce({ records: [first], next_token: "page2" })
      .mockResolvedValueOnce({ records: [second] });

    const result = await querySteps(2, today(), today(), "whoop");

    expect(whoopGetMock).toHaveBeenCalledTimes(2);
    expect(whoopGetMock).toHaveBeenLastCalledWith(
      expect.stringContaining("nextToken=page2"),
      expect.objectContaining({ userId: 2 }),
    );
    expect(upsertCyclesAndRecompute).toHaveBeenCalledWith([first, second], 2, TZ);
    expect(getStepsRangeMock).toHaveBeenCalledTimes(2);
    expect(getStepsRangeMock).toHaveBeenLastCalledWith(2, today(), today(), "whoop");
    expect(result.rows).toEqual([refreshed]);
    expect(result._meta).toMatchObject({ refresh: "updated", source: "whoop", steps_stale: false });
  });

  it("refreshes when a fresh historical row masks an old today row", async () => {
    const yesterday = daysAgo(1);
    const historical = storedRow({ date: yesterday });
    const todayRow = staleRow();
    const refreshedToday = storedRow();
    getStepsRangeMock
      .mockReturnValueOnce([historical, todayRow])
      .mockReturnValueOnce([historical, refreshedToday]);
    whoopGetMock.mockResolvedValueOnce({
      records: [{ id: 3, start: "2026-09-25T02:09:00Z", step_count: 999 }],
    });

    const result = await querySteps(2, yesterday, today(), "whoop");

    expect(whoopGetMock).toHaveBeenCalledTimes(1);
    expect(result.rows).toEqual([historical, refreshedToday]);
    expect(result._meta).toMatchObject({ refresh: "updated", steps_stale: false });
  });

  it("refreshes when a fresh historical row exists but today has no stored row", async () => {
    const yesterday = daysAgo(1);
    const historical = storedRow({ date: yesterday });
    const refreshedToday = storedRow();
    getStepsRangeMock
      .mockReturnValueOnce([historical])
      .mockReturnValueOnce([historical, refreshedToday]);
    whoopGetMock.mockResolvedValueOnce({
      records: [{ id: 4, start: "2026-09-25T02:09:00Z", step_count: 1200 }],
    });

    const result = await querySteps(2, yesterday, today(), "whoop");

    expect(whoopGetMock).toHaveBeenCalledTimes(1);
    expect(result.rows).toEqual([historical, refreshedToday]);
    expect(result._meta).toMatchObject({ refresh: "updated", steps_stale: false });
  });

  it("ignores historical rows when today's row is fresh", async () => {
    const yesterday = daysAgo(1);
    const rows = [staleRow({ date: yesterday }), storedRow()];
    getStepsRangeMock.mockReturnValue(rows);

    const result = await querySteps(2, yesterday, today(), "whoop");

    expect(whoopGetMock).not.toHaveBeenCalled();
    expect(result._meta).toMatchObject({ refresh: "not_requested", steps_stale: false });
  });

  it("enforces the 3 s deadline across token acquisition and skips late writes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const stale = staleRow();
      getStepsRangeMock.mockReturnValue([stale]);
      whoopGetMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () => resolve({ records: [{ id: 5, start: "2026-09-25T02:09:00Z", step_count: 4321 }] }),
              3_400,
            );
          }),
      );

      const pending = querySteps(2, today(), today(), "whoop");
      await vi.advanceTimersByTimeAsync(3_000);
      const result = await pending;

      expect(result.rows).toEqual([stale]);
      expect(result._meta).toMatchObject({ refresh: "failed", steps_stale: true });
      expect(result._meta.error).toMatch(/timed out/i);
      expect(upsertCyclesAndRecompute).not.toHaveBeenCalled();

      // The slow WHOOP response lands after the deadline; it must not write.
      await vi.advanceTimersByTimeAsync(500);
      expect(upsertCyclesAndRecompute).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns saved data with explicit failure, without exposing upstream bodies", async () => {
    getStepsRangeMock.mockReturnValue([staleRow()]);
    whoopGetMock.mockRejectedValueOnce(new Error("private upstream response"));

    const result = await querySteps(2, today(), today(), "whoop");

    expect(result._meta.refresh).toBe("failed");
    expect(result._meta.steps_stale).toBe(true);
    expect(result._meta.error).toContain("saved data");
    expect(JSON.stringify(result)).not.toContain("private upstream");
    expect(upsertCyclesAndRecompute).not.toHaveBeenCalled();
  });

  it("reports a malformed upstream response as a failed refresh", async () => {
    getStepsRangeMock.mockReturnValue([staleRow()]);
    whoopGetMock.mockResolvedValueOnce({});

    const result = await querySteps(2, today(), today(), "whoop");

    expect(result._meta.refresh).toBe("failed");
    expect(upsertCyclesAndRecompute).not.toHaveBeenCalled();
  });

  it("identifies a disconnected Whoop account and does not fall back to Apple Health", async () => {
    getStepsRangeMock.mockReturnValue([staleRow()]);
    whoopGetMock.mockRejectedValueOnce(new WhoopAuthError());

    const result = await querySteps(2, today(), today(), "whoop");

    expect(result._meta.error).toContain("Reconnect Whoop");
    expect(getStepsRangeMock).toHaveBeenCalledWith(2, today(), today(), "whoop");
  });

  it("does not refresh Whoop when Apple Health was explicitly requested", async () => {
    const result = await querySteps(2, "2026-09-24", "2026-09-26", "apple_health");

    expect(whoopGetMock).not.toHaveBeenCalled();
    expect(result._meta).toMatchObject({
      refresh: "not_requested",
      steps_stale: false,
      source: "apple_health",
      time_basis: "calendar_day",
    });
  });

  it("bounds pagination and does not commit an incomplete fetch", async () => {
    getStepsRangeMock.mockReturnValue([staleRow()]);
    whoopGetMock.mockResolvedValue({ records: [], next_token: "loop" });

    const result = await querySteps(2, today(), today(), "whoop");

    expect(whoopGetMock).toHaveBeenCalledTimes(16);
    expect(result._meta.refresh).toBe("failed");
    expect(upsertCyclesAndRecompute).not.toHaveBeenCalled();
  });

  it("propagates caller cancellation before any work", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      querySteps(2, today(), today(), "whoop", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(getStepsRangeMock).not.toHaveBeenCalled();
    expect(whoopGetMock).not.toHaveBeenCalled();
  });

  it("propagates caller cancellation during a refresh", async () => {
    const controller = new AbortController();
    getStepsRangeMock.mockReturnValue([staleRow()]);
    whoopGetMock.mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });

    await expect(
      querySteps(2, today(), today(), "whoop", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(upsertCyclesAndRecompute).not.toHaveBeenCalled();
  });
});
