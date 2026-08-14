import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildCursorSystemPrompt,
  buildSystemPrompt,
  CURSOR_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  normalizeCustomInstructions,
} from "./prompts";

// Issue #498 — normalizeCustomInstructions replaced resolveSystemPrompt.
// resolveSystemPrompt returned the user's text INSTEAD of
// DEFAULT_SYSTEM_PROMPT; wiring that into the coach would have let any user
// silently drop the tool-usage, date and safety rules (including "never
// invent a value") just by typing in the Settings textarea. Custom
// instructions are additive now, so the helper's only job is deciding
// whether the user has instructions at all.
describe("normalizeCustomInstructions", () => {
  it("returns the user's instructions when present", () => {
    expect(normalizeCustomInstructions("be terse")).toBe("be terse");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeCustomInstructions("  be terse \n")).toBe("be terse");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["a whitespace-only string", "   "],
    ["a whitespace-and-newline string", " \n\t "],
  ])("returns null for %s", (_label, value) => {
    expect(normalizeCustomInstructions(value)).toBeNull();
  });
});

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

// Issue #498 — the stored per-user "Instructions" must reach the model, and
// must do so WITHOUT disturbing the cached DEFAULT_SYSTEM_PROMPT block.
describe("buildSystemPrompt custom instructions (issue #498)", () => {
  const NOW = new Date("2026-05-02T00:00:00Z");

  it("appends the user's instructions as a trailing uncached block", () => {
    const prompt = buildSystemPrompt(NOW, null, "Always mention my HRV trend.");

    expect(prompt).toHaveLength(3);
    expect(prompt[2].text).toContain("Always mention my HRV trend.");
    expect(prompt[2]).not.toHaveProperty("cache_control");
  });

  it("adds to DEFAULT_SYSTEM_PROMPT instead of replacing it", () => {
    const prompt = buildSystemPrompt(NOW, null, "Only ever reply in haiku.");

    // The safety rules survive a custom prompt — this is the whole point of
    // the additive model.
    expect(prompt[1].text).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(prompt[1].text).toContain("never invent values");
    expect(
      prompt.some((block) => block.text.includes("Only ever reply in haiku.")),
    ).toBe(true);
  });

  it("leaves the cached default block byte-identical when instructions are set", () => {
    const withInstructions = buildSystemPrompt(NOW, null, "be terse");
    const without = buildSystemPrompt(NOW);

    expect(withInstructions[1]).toEqual(without[1]);
    expect(withInstructions[1].cache_control).toEqual({
      type: "ephemeral",
      ttl: "1h",
    });
    // Block 1 (the date) is shared too — only the tail differs.
    expect(withInstructions[0]).toEqual(without[0]);
  });

  it("orders blocks date -> default -> goals -> instructions", () => {
    const prompt = buildSystemPrompt(NOW, ["sleep_better"], "be terse");

    expect(prompt).toHaveLength(4);
    expect(prompt[0].text).toBe("Today's date is 2026-05-01.");
    expect(prompt[1].text).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(prompt[2].text).toContain("sleep better");
    expect(prompt[3].text).toContain("be terse");
    expect(prompt[2]).not.toHaveProperty("cache_control");
    expect(prompt[3]).not.toHaveProperty("cache_control");
  });

  it("subordinates the user's text to the built-in safety rules", () => {
    const prompt = buildSystemPrompt(NOW, null, "be terse");

    expect(prompt[2].text).toMatch(/adds to the rules above/i);
    expect(prompt[2].text).toMatch(/those rules win/i);
  });

  // The cache-protecting property: an absent / blank instruction value must
  // produce a prompt byte-identical to the pre-#498 output, or every user
  // with a blank textarea pays a cache write.
  it.each([
    ["null", null],
    ["an empty string", ""],
    ["a whitespace-only string", "   "],
  ])("is byte-identical to the no-instructions prompt for %s", (_l, value) => {
    const baseline = buildSystemPrompt(NOW);

    expect(buildSystemPrompt(NOW, null, value)).toEqual(baseline);
    expect(JSON.stringify(buildSystemPrompt(NOW, null, value))).toBe(
      JSON.stringify(baseline),
    );
  });

  it("keeps the goals-only prompt byte-identical when instructions are blank", () => {
    const baseline = buildSystemPrompt(NOW, ["sleep_better"]);

    expect(JSON.stringify(buildSystemPrompt(NOW, ["sleep_better"], "  "))).toBe(
      JSON.stringify(baseline),
    );
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
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/cooldown_window_seconds/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/next_sync_allowed_at/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/try again in/i);
  });
});

describe("buildCursorSystemPrompt", () => {
  it("keeps Cursor-specific safety and routing rules compact", () => {
    const prompt = buildCursorSystemPrompt(
      new Date("2026-05-02T02:35:00.000Z"),
      ["sleep_better"],
    );

    expect(prompt).toContain("Today's date is 2026-05-01.");
    expect(prompt).toContain("under 12 words");
    expect(prompt).toContain("query_daily_snapshot once");
    expect(prompt).toContain("Sync is unavailable");
    expect(prompt).toContain("sleep better");
    expect(prompt.length).toBeLessThan(DEFAULT_SYSTEM_PROMPT.length / 2);
  });

  it("does not duplicate the full tool schema catalog", () => {
    expect(CURSOR_SYSTEM_PROMPT).not.toContain("cooldown_window_seconds");
    expect(CURSOR_SYSTEM_PROMPT).not.toContain("zone_0_ms");
  });

  // Issue #498 — honouring the user's instructions on Anthropic but ignoring
  // them on Cursor would be worse than either consistent choice.
  it("appends the user's instructions additively", () => {
    const prompt = buildCursorSystemPrompt(
      new Date("2026-05-02T00:00:00Z"),
      null,
      "Always mention my HRV trend.",
    );

    expect(prompt).toContain(CURSOR_SYSTEM_PROMPT);
    expect(prompt).toContain("Always mention my HRV trend.");
    // Cursor's own safety rule survives alongside the custom text.
    expect(prompt).toContain("never invent a value");
    expect(prompt.indexOf("Always mention my HRV trend.")).toBeGreaterThan(
      prompt.indexOf(CURSOR_SYSTEM_PROMPT),
    );
  });

  it("keeps instructions after the goals sentence", () => {
    const prompt = buildCursorSystemPrompt(
      new Date("2026-05-02T00:00:00Z"),
      ["sleep_better"],
      "be terse",
    );

    expect(prompt.indexOf("be terse")).toBeGreaterThan(
      prompt.indexOf("sleep better"),
    );
  });

  it.each([
    ["null", null],
    ["an empty string", ""],
    ["a whitespace-only string", "   "],
  ])("is byte-identical to the no-instructions prompt for %s", (_l, value) => {
    const now = new Date("2026-05-02T00:00:00Z");

    expect(buildCursorSystemPrompt(now, null, value)).toBe(
      buildCursorSystemPrompt(now),
    );
  });
});
