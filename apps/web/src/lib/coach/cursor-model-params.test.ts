import { describe, expect, it } from "vitest";
import {
  cursorBooleanParameterValues,
  cursorModelArgument,
  cursorReasoningValueLabel,
  isCursorReasoningParameter,
  parseCursorModelParamsByModel,
} from "./cursor-model-params";

describe("Cursor model parameters", () => {
  it("presents boolean reasoning as an on/off control", () => {
    const parameter = {
      id: "thinking",
      display_name: "Reasoning",
      values: [
        { value: "true", display_name: null },
        { value: "false", display_name: null },
      ],
    };

    expect(cursorBooleanParameterValues(parameter)).toEqual({
      on: parameter.values[0],
      off: parameter.values[1],
    });
    expect(cursorReasoningValueLabel(parameter, "true")).toBe("Reasoning on");
    expect(cursorReasoningValueLabel(parameter, "false")).toBe("Reasoning off");
  });

  it("formats validated parameters for cursor-agent", () => {
    expect(
      cursorModelArgument("claude-opus-4-8", [
        { id: "context", value: "1m" },
        { id: "effort", value: "high" },
        { id: "fast", value: "false" },
      ]),
    ).toBe("claude-opus-4-8[context=1m,effort=high,fast=false]");
  });

  it("recognizes Cursor's reasoning parameter vocabulary", () => {
    expect(
      ["thinking", "reasoning", "effort", "thought_level"].every((id) =>
        isCursorReasoningParameter({ id, display_name: null }),
      ),
    ).toBe(true);
  });

  it("drops unsafe stored parameter data", () => {
    expect(
      parseCursorModelParamsByModel({
        "gpt-5.5": [
          { id: "effort", value: "high" },
          { id: "effort", value: "low" },
          { id: "bad,value", value: "high" },
        ],
        "bad[model]": [{ id: "effort", value: "high" }],
      }),
    ).toEqual({
      "gpt-5.5": [{ id: "effort", value: "high" }],
    });
  });
});
