import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { computeShadowRouting } = await import("./persistence");

const turn = (displayText: string) => ({ displayText, modelText: displayText, images: [] });

describe("computeShadowRouting (issue #489)", () => {
  it("is a no-op with the flag unset", () => {
    expect(computeShadowRouting(turn("hi"), [], {})).toBeNull();
    expect(computeShadowRouting(turn("hi"), [], { COACH_TURN_ROUTING: "off" })).toBeNull();
  });

  it("returns a shadow receipt when enabled, using prior user turns as context", () => {
    const receipt = computeShadowRouting(
      turn("what about yesterday?"),
      [{ role: "user", contentBlocks: [{ type: "text", text: "how did I sleep last night?" }], images: [] }],
      { COACH_TURN_ROUTING: "shadow" },
    );
    expect(receipt).toMatchObject({
      mode: "shadow",
      lane: "simple_data",
      executed_lane: "agentic",
      enforced: false,
      allowed_tools: ["query_sleep"],
    });
    expect(receipt?.router_ms).toBeGreaterThanOrEqual(0);
  });
});
