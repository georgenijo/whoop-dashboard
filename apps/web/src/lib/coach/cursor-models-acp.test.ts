// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const dispose = vi.hoisted(() => vi.fn(async () => {}));
const listAvailableModels = vi.hoisted(() => vi.fn());
const start = vi.hoisted(() =>
  vi.fn(async () => ({
    listAvailableModels,
    dispose,
  })),
);

vi.mock("./cursor-acp-runtime", () => ({
  CursorAcpRuntime: { start },
}));
vi.mock("./cursor-acp-registry", () => ({
  cursorCredentialFingerprint: vi.fn(() => "credential"),
  cursorPromptFingerprint: vi.fn(() => "prompt"),
}));

describe("ACP-backed Cursor model catalog", () => {
  beforeEach(() => {
    vi.stubEnv("COACH_CURSOR_TRANSPORT", "acp");
    start.mockClear();
    dispose.mockClear();
    listAvailableModels.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("uses cursor/list_available_models from the authenticated ACP runtime", async () => {
    listAvailableModels.mockResolvedValue({
      models: [
        {
          value: "gpt-5.6-luna",
          name: "GPT-5.6 Luna",
          configOptions: [],
        },
      ],
    });
    const { listCursorModelsForKey } = await import("./cursor-models");

    await expect(listCursorModelsForKey("key_personal", 7)).resolves.toEqual([
      {
        id: "gpt-5.6-luna",
        display_name: "GPT-5.6 Luna",
        description: null,
        parameters: [],
        variants: [],
      },
    ]);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        key: "key_personal",
        withMcp: false,
      }),
    );
    expect(dispose).toHaveBeenCalledOnce();
  });
});
