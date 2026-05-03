import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildSystemPrompt } from "./prompts";

describe("buildSystemPrompt", () => {
  it("uses the Coach timezone for today's date", () => {
    const prompt = buildSystemPrompt(new Date("2026-05-02T02:35:00.000Z"));

    expect(prompt[0]).toEqual({
      type: "text",
      text: "Today's date is 2026-05-01.",
    });
  });
});
