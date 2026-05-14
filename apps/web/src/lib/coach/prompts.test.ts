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

  it("appends a 3rd uncached block when goals are non-empty", () => {
    const prompt = buildSystemPrompt(
      new Date("2026-05-02T00:00:00Z"),
      ["sleep_better", "manage_stress"],
    );
    expect(prompt).toHaveLength(3);
    expect(prompt[2]).toEqual({
      type: "text",
      text: expect.stringContaining("sleep better, manage stress"),
    });
    expect(prompt[2]).not.toHaveProperty("cache_control");
  });

  it("no-goals path returns exactly 2 blocks (byte-identical to pre-Phase-E.1)", () => {
    const prompt = buildSystemPrompt(new Date("2026-05-02T00:00:00Z"));
    expect(prompt).toHaveLength(2);
    expect(prompt[1].text).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it("silently drops unknown goal IDs", () => {
    const prompt = buildSystemPrompt(
      new Date("2026-05-02T00:00:00Z"),
      ["sleep_better", "this_is_not_a_real_goal"],
    );
    expect(prompt).toHaveLength(3);
    expect(prompt[2].text).toContain("sleep better");
    expect(prompt[2].text).not.toContain("this_is_not_a_real_goal");
  });

  it("returns 2 blocks when all goal IDs are unknown", () => {
    const prompt = buildSystemPrompt(
      new Date("2026-05-02T00:00:00Z"),
      ["only_unknown_ids"],
    );
    expect(prompt).toHaveLength(2);
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

  it("requires a one-sentence text block before any tool call", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/every turn must start with text/i);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/under 12 words/i);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/never emit a tool_use block as the first content/i);
  });

  it("tells the model to surface a concrete cooldown duration from next_sync_allowed_at", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/cooldown_seconds/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/next_sync_allowed_at/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/try again in/i);
  });
});
