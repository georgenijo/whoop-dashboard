import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildSystemPrompt, DEFAULT_SYSTEM_PROMPT } from "./prompts";

describe("buildSystemPrompt", () => {
  it("uses the Coach timezone for today's date", () => {
    const prompt = buildSystemPrompt(new Date("2026-05-02T02:35:00.000Z"));

    expect(prompt[0]).toEqual({
      type: "text",
      text: "Today's date is 2026-05-01.",
    });
  });
});

describe("DEFAULT_SYSTEM_PROMPT", () => {
  it("documents the row-dating convention for sleep/recovery/strain", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/sleep date = wake date/i);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/last night.*today's date/i);
  });
});
