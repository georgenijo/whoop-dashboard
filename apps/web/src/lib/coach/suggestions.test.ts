import { describe, expect, it } from "vitest";
import { coachSuggestions, DEFAULT_SUGGESTION_CONTEXT } from "./suggestions";

const texts = (context = DEFAULT_SUGGESTION_CONTEXT) =>
  coachSuggestions(context).map((suggestion) => suggestion.text);

describe("coachSuggestions", () => {
  it("offers last night's sleep only once it is scored", () => {
    expect(texts()).not.toContain("How did I sleep last night?");
    expect(texts({ ...DEFAULT_SUGGESTION_CONTEXT, sleepScored: true })).toContain(
      "How did I sleep last night?",
    );
  });

  it("asks about today's recovery once scored, the trend otherwise", () => {
    expect(texts()).toContain("How is my recovery trending this week?");
    expect(texts({ ...DEFAULT_SUGGESTION_CONTEXT, recoveryScored: true })).toContain(
      "What's behind today's recovery score?",
    );
  });

  it("asks about today's workout when one is logged", () => {
    expect(texts({ ...DEFAULT_SUGGESTION_CONTEXT, workoutsToday: 1 })).toContain(
      "How hard was today's workout?",
    );
    expect(texts({ ...DEFAULT_SUGGESTION_CONTEXT, workoutsToday: 2 })).toContain(
      "How hard were today's workouts?",
    );
  });

  it("doesn't offer data prompts to a user with no data yet", () => {
    const suggestions = coachSuggestions({ ...DEFAULT_SUGGESTION_CONTEXT, hasHistory: false });
    expect(suggestions.every((suggestion) => suggestion.kind === "general")).toBe(true);
  });

  it("never shows more than four", () => {
    for (const sleepScored of [true, false]) {
      for (const recoveryScored of [true, false]) {
        expect(
          coachSuggestions({ sleepScored, recoveryScored, workoutsToday: 1, hasHistory: true }).length,
        ).toBeLessThanOrEqual(4);
      }
    }
  });
});
