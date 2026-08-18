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

import { runCursorProviderTurn } from "./cursor-provider-adapter";

afterEach(() => {
  vi.unstubAllEnvs();
  legacy.mockClear();
  acp.mockClear();
});

describe("runCursorProviderTurn", () => {
  it("keeps the legacy path as the rollout default", async () => {
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
});
