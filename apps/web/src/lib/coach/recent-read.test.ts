import { describe, expect, it } from "vitest";
import { selectRecentRead, withRecentRead } from "./recent-read";

describe("conservative recent read selection", () => {
  it.each([
    ["How was my recovery this week?", "query_recovery", "2026-11-08", "2026-11-14"],
    ["How did I sleep last night?", "query_sleep", "2026-11-14", "2026-11-14"],
    ["Show my strain yesterday", "query_strain", "2026-11-13", "2026-11-13"],
    ["Review my workouts today", "query_workouts", "2026-11-14", "2026-11-14"],
    ["How was my recovery this week? Give the key numbers and one clear recommendation in at most 120 words. Do not sync data or save a plan.", "query_recovery", "2026-11-08", "2026-11-14"],
  ])("resolves %s", (text, name, start_date, end_date) => {
    expect(selectRecentRead(text, "2026-11-14")).toEqual({ name, input: { start_date, end_date } });
  });

  it("subtracts calendar days across month/year boundaries", () => {
    expect(selectRecentRead("How was my recovery this week?", "2026-01-03")?.input)
      .toEqual({ start_date: "2025-12-28", end_date: "2026-01-03" });
  });

  it.each([
    "Hello", "How am I doing today?", "Why is my recovery low?",
    "Compare my sleep today with yesterday", "Show recovery today and this week",
    "How was my recovery on 2026-11-01, not today?",
    "How did I sleep last night on Nov 3?", "Show recovery since Monday",
    "How was my recovery this week versus last week?",
    "Show sleep for the last 14 days", "Show my recovery today except yesterday",
    "How did recovery and sleep look today?", "How did my sleep and naps look today?",
    "Show my steps today", "Show my workout plan today",
    "Check my recovery today and sync now", "Check my sleep today again",
    "How did I sleep last night? Do not sync data; save a plan instead.",
    "How was my recovery today? Don't query my data; explain generally.",
    "How is my sleep tonight? Without accessing my health records.",
    "How was my recovery today without querying my data?",
    "How was my recovery today? Use only the numbers I provided.",
    "How was my recovery today? Keep my health records out of the model.",
    "How was my recovery today? Avoid using tools.",
  ])("leaves ambiguous, unrelated, freshness, or write requests model-led: %s", (text) => {
    expect(selectRecentRead(text, "2026-11-14")).toBeNull();
  });
});

describe("server-fetched context", () => {
  it("adds a separate user-priority block without modifying the original conversation", () => {
    const conversation = [{ role: "user" as const, content: "How did I sleep last night?" }];
    const read = selectRecentRead(conversation[0].content, "2026-11-14")!;
    const result = withRecentRead(conversation, read, '[{"date":"2026-11-14"}]');
    expect(conversation).toEqual([{ role: "user", content: "How did I sleep last night?" }]);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toEqual([
      { type: "text", text: conversation[0].content },
      { type: "text", text: expect.stringContaining('[{"date":"2026-11-14"}]') },
    ]);
    expect(JSON.stringify(result)).toContain("sync/re-query");
    expect(JSON.stringify(result)).not.toContain('"type":"tool_use"');
  });
});
