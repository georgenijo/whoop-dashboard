import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ToolDetail } from "./tools";
import { CoachWorkLogCollector } from "./work-log";

function detail(
  id: string,
  overrides: Partial<ToolDetail> = {},
): ToolDetail {
  return {
    id,
    name: "query_recovery",
    input: {},
    duration_ms: 10,
    rows: 1,
    status: "ok",
    response: [{ recovery_score: 70 }],
    ...overrides,
  };
}

describe("CoachWorkLogCollector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a completed empty receipt for a direct no-tool turn", () => {
    const collector = new CoachWorkLogCollector();
    const handlers = collector.wrap({});
    handlers.onTextDelta?.("Direct final answer");

    expect(collector.complete(45, [])).toEqual({
      version: 1,
      status: "complete",
      duration_ms: 45,
      notes: [],
      tools: [],
    });
  });

  it("captures visible pre-tool text as a note but excludes final answer text", () => {
    const collector = new CoachWorkLogCollector();
    const handlers = collector.wrap({});
    handlers.onTextDelta?.("I’ll check your latest data.");
    handlers.onToolUseStart?.({
      id: "one",
      name: "query_recovery",
      input: {},
    });
    handlers.onTextDelta?.("Your final answer.");

    const log = collector.complete(100, [detail("one")]);

    expect(log.notes).toEqual(["I’ll check your latest data."]);
    expect(log.notes).not.toContain("Your final answer.");
  });

  it("preserves sequential and parallel tool start order by stable id", () => {
    const collector = new CoachWorkLogCollector();
    const handlers = collector.wrap({});
    handlers.onToolUseStart?.({
      id: "first",
      name: "query_recovery",
      input: {},
    });
    handlers.onToolUseStart?.({
      id: "second",
      name: "query_sleep",
      input: {},
    });
    handlers.onToolUseStart?.({
      id: "third",
      name: "query_strain",
      input: {},
    });
    handlers.onToolProgress?.({
      id: "second",
      tool: "query_sleep",
      stage: "reading_rows",
      message: "Reading sleep rows",
    });
    const log = collector.complete(100, [
      detail("third", { name: "query_strain" }),
      detail("first"),
      detail("second", { name: "query_sleep" }),
    ]);

    expect(log.tools.map((tool) => tool.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(log.tools[1]).toMatchObject({
      stage: "reading_rows",
      stage_message: "Reading sleep rows",
    });
  });

  it("preserves failed tool status and bounded response data", () => {
    const collector = new CoachWorkLogCollector();
    const oversized = Array.from({ length: 300 }, (_, index) => ({
      index,
      padding: "x".repeat(80),
    }));
    const log = collector.complete(100, [
      detail("failed", {
        status: "error",
        rows: null,
        error: "database unavailable",
        response: oversized,
      }),
    ]);

    expect(log.tools[0]).toMatchObject({
      id: "failed",
      status: "error",
      error: "database unavailable",
      response: {
        _truncated: true,
        total_count: 300,
      },
    });
    expect(
      (log.tools[0].response as { preview: unknown[] }).preview,
    ).toHaveLength(5);
  });

  it("redacts secret-like keys in persisted inputs and results", () => {
    const collector = new CoachWorkLogCollector();
    const log = collector.complete(100, [
      detail("secret", {
        input: {
          api_key: "input-secret",
          nested: { authorization: "Bearer secret", safe: "visible" },
        },
        response: { token: "result-secret", value: 42 },
      }),
    ]);

    expect(log.tools[0].input).toEqual({
      api_key: "[REDACTED]",
      nested: { authorization: "[REDACTED]", safe: "visible" },
    });
    expect(log.tools[0].response).toEqual({
      token: "[REDACTED]",
      value: 42,
    });
  });
});
