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

  it("forbids inferring data state from a skipped sync", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/rate-limited and did NOT run/i);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/do NOT tell the user "no new data"/i);
  });

  it("requires re-querying after every trigger_whoop_sync outcome", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(
      /after every trigger_whoop_sync outcome[\s\S]*re-query/i,
    );
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(
      /sync return is a status signal, not a data-state assertion/i,
    );
  });

  it("requires re-querying when the user contests data presence", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/pushback path/i);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/check now/i);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(
      /contests your data answer[\s\S]*re-query/i,
    );
  });
});
