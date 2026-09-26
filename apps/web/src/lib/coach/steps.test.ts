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

import { getStepsRange } from "@/lib/db/steps";
import { whoopGet, WhoopAuthError } from "@/lib/whoop/client";
import { upsertCyclesAndRecompute } from "@/lib/whoop/upsert";
import { querySteps } from "./steps";

beforeEach(() => vi.clearAllMocks());

describe("native steps refresh", () => {
  it("fetches every page before persisting and querying the requested tenant/source", async () => {
    const first = { id: 2, start: "2026-09-25T02:09:00Z", step_count: 25725 };
    const second = { id: 1, start: "2026-09-24T04:22:00Z", step_count: 19006 };
    vi.mocked(whoopGet).mockResolvedValueOnce({ records: [first], next_token: "page2" })
      .mockResolvedValueOnce({ records: [second] });
    const result = await querySteps(2, "2026-09-24", "2026-09-26", "whoop");
    expect(whoopGet).toHaveBeenCalledTimes(2);
    expect(whoopGet).toHaveBeenLastCalledWith(expect.stringContaining("nextToken=page2"), expect.objectContaining({ userId: 2 }));
    expect(upsertCyclesAndRecompute).toHaveBeenCalledWith([first, second], 2, "America/New_York");
    expect(getStepsRange).toHaveBeenCalledWith(2, "2026-09-24", "2026-09-26", "whoop");
    expect(result._meta).toMatchObject({ refresh: "updated", source: "whoop", time_basis: "physiological_cycle", error: null });
  });

  it("returns saved data with explicit failure, without exposing upstream bodies", async () => {
    vi.mocked(whoopGet).mockRejectedValueOnce(new Error("private upstream response"));
    const result = await querySteps(2, "2026-09-24", "2026-09-26", "whoop");
    expect(result._meta.refresh).toBe("failed");
    expect(result._meta.error).toContain("saved data");
    expect(JSON.stringify(result)).not.toContain("private upstream");
    expect(upsertCyclesAndRecompute).not.toHaveBeenCalled();
  });

  it("reports a malformed upstream response as a failed refresh", async () => {
    vi.mocked(whoopGet).mockResolvedValueOnce({});
    const result = await querySteps(2, "2026-09-24", "2026-09-26", "whoop");
    expect(result._meta.refresh).toBe("failed");
    expect(upsertCyclesAndRecompute).not.toHaveBeenCalled();
  });

  it("identifies a disconnected Whoop account and does not fall back to Apple Health", async () => {
    vi.mocked(whoopGet).mockRejectedValueOnce(new WhoopAuthError());
    const result = await querySteps(2, "2026-09-24", "2026-09-26", "whoop");
    expect(result._meta.error).toContain("Reconnect Whoop");
    expect(getStepsRange).toHaveBeenCalledWith(2, "2026-09-24", "2026-09-26", "whoop");
  });

  it("does not refresh Whoop when Apple Health was explicitly requested", async () => {
    const result = await querySteps(2, "2026-09-24", "2026-09-26", "apple_health");
    expect(whoopGet).not.toHaveBeenCalled();
    expect(result._meta).toMatchObject({ refresh: "not_requested", source: "apple_health", time_basis: "calendar_day" });
  });

  it("bounds pagination and does not commit an incomplete fetch", async () => {
    vi.mocked(whoopGet).mockResolvedValue({ records: [], next_token: "loop" });
    const result = await querySteps(2, "2026-09-24", "2026-09-26", "whoop");
    expect(whoopGet).toHaveBeenCalledTimes(16);
    expect(result._meta.refresh).toBe("failed");
    expect(upsertCyclesAndRecompute).not.toHaveBeenCalled();
  });

  it("propagates caller cancellation without presenting a completed query", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.mocked(whoopGet).mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    await expect(querySteps(2, "2026-09-24", "2026-09-26", "whoop", controller.signal)).rejects.toThrow("Aborted");
    expect(getStepsRange).not.toHaveBeenCalled();
  });
});
