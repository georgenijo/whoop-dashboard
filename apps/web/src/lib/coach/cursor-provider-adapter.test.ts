// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const legacy = vi.hoisted(() =>
  vi.fn(async () => ({
    reply: "legacy",
    iterations: 1,
    messages: [],
  })),
);
const acp = vi.hoisted(() =>
  vi.fn(async () => ({
    reply: "acp",
    iterations: 1,
    messages: [],
  })),
);
vi.mock("./cursor-loop", () => ({ runCursorTurn: legacy }));
vi.mock("./cursor-acp-turn", () => ({ runCursorAcpTurn: acp }));
const memoryCheck = vi.hoisted(() => vi.fn());
vi.mock("./cursor-memory", () => ({ assertCursorSpawnMemory: memoryCheck }));

import { runCursorProviderTurn } from "./cursor-provider-adapter";

afterEach(() => {
  vi.unstubAllEnvs();
  legacy.mockClear();
  acp.mockClear();
  memoryCheck.mockReset();
});

describe("runCursorProviderTurn", () => {
  it("keeps the legacy path as the rollout default", async () => {
    vi.stubEnv("COACH_CURSOR_TRANSPORT", "legacy");
    const result = await runCursorProviderTurn({} as never);
    expect(result.reply).toBe("legacy");
    expect(legacy).toHaveBeenCalledOnce();
    expect(acp).not.toHaveBeenCalled();
  });

  it("selects ACP only when the transport flag is enabled", async () => {
    vi.stubEnv("COACH_CURSOR_TRANSPORT", "acp");
    const result = await runCursorProviderTurn({} as never);
    expect(result.reply).toBe("acp");
    expect(acp).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
  });

  it("runs the memory pre-flight before a legacy spawn and does not spawn when it throws", async () => {
    vi.stubEnv("COACH_CURSOR_TRANSPORT", "legacy");
    memoryCheck.mockImplementation(() => {
      throw new Error("low memory");
    });
    await expect(runCursorProviderTurn({} as never)).rejects.toThrow("low memory");
    expect(legacy).not.toHaveBeenCalled();
  });

  it("skips the memory pre-flight for ACP (warm sessions spawn nothing)", async () => {
    vi.stubEnv("COACH_CURSOR_TRANSPORT", "acp");
    await runCursorProviderTurn({} as never);
    expect(memoryCheck).not.toHaveBeenCalled();
  });
});
