import { describe, expect, it } from "vitest";
import {
  cursorAcpConfigValue,
  cursorModelsFromAcp,
  findCursorAcpConfigOption,
} from "./cursor-acp-models";

const configOptions = [
  {
    type: "select" as const,
    id: "reasoning",
    name: "Reasoning",
    category: "thought_level",
    currentValue: "low",
    options: [
      { value: "low", name: "Low" },
      { value: "high", name: "High" },
    ],
  },
  {
    type: "boolean" as const,
    id: "fast",
    name: "Fast mode",
    category: "model_config",
    currentValue: false,
  },
];

describe("Cursor ACP model normalization", () => {
  it("preserves model-specific config choices and defaults", () => {
    expect(
      cursorModelsFromAcp({
        models: [
          {
            value: "gpt-5.6-luna",
            name: "GPT-5.6 Luna",
            configOptions,
          },
        ],
      }),
    ).toEqual([
      {
        id: "gpt-5.6-luna",
        display_name: "GPT-5.6 Luna",
        description: null,
        parameters: [
          {
            id: "reasoning",
            display_name: "Reasoning",
            values: [
              { value: "low", display_name: "Low" },
              { value: "high", display_name: "High" },
            ],
          },
          {
            id: "fast",
            display_name: "Fast mode",
            values: [
              { value: "true", display_name: "On" },
              { value: "false", display_name: "Off" },
            ],
          },
        ],
        variants: [
          {
            params: [
              { id: "reasoning", value: "low" },
              { id: "fast", value: "false" },
            ],
            display_name: "Default",
            description: null,
            is_default: true,
          },
        ],
      },
    ]);
  });

  it("matches reasoning aliases and validates boolean values", () => {
    const option = findCursorAcpConfigOption(configOptions, {
      id: "effort",
      value: "high",
    });
    expect(option?.id).toBe("reasoning");
    expect(cursorAcpConfigValue(configOptions[1], "true")).toBe(true);
    expect(cursorAcpConfigValue(configOptions[1], "yes")).toBeNull();
  });
});
