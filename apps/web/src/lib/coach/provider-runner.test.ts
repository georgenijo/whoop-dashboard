// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const runAnthropic = vi.hoisted(() => vi.fn());
vi.mock("./loop", () => ({ runAnthropicSdk: runAnthropic }));
vi.mock("./cursor-provider-adapter", () => ({ runCursorProviderTurn: vi.fn() }));
import { runCoachProviderTurn } from "./provider-runner";

it("passes the selected Anthropic model into the SDK loop", async () => {
  const accumulator: [] = [];
  await runCoachProviderTurn({
    userId: 1, threadId: 7,
    selection: { provider: "anthropic", model: "claude-opus-4-6" },
    turn: { displayText: "Hello", modelText: "Hello", images: [] },
    conversation: [], anthropicApiKey: "personal", anthropicApiKeyOrigin: "user",
    toolDetails: [], usage: { calls: 0, input_tokens_total: 0, output_tokens_total: 0,
      cache_creation_input_tokens_total: 0, cache_read_input_tokens_total: 0 },
    detailState: { iterations: 0 }, options: {}, accumulator,
  });
  expect(runAnthropic.mock.calls[0].slice(-2)).toEqual([accumulator, "claude-opus-4-6"]);
});
