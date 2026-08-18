import { describe, expect, it } from "vitest";
import {
  extractCoachPresentation,
  MAX_PRESENTATION_BLOCKS,
  parseCoachPresentationBlocks,
} from "./presentation";

const metric = {
  version: 1,
  type: "metric_strip",
  fallback: "Recovery 78 percent and HRV 62 milliseconds.",
  metrics: [
    {
      label: "Recovery",
      value: 78,
      display_value: "78%",
      unit: "%",
      direction: "up",
      tone: "positive",
    },
  ],
};

describe("Coach presentation contract", () => {
  it("extracts a valid provider-neutral proposal and removes its fence", () => {
    const result = extractCoachPresentation(
      `Your recovery is strong.\n\n\`\`\`coach-blocks\n${JSON.stringify([metric])}\n\`\`\``,
    );
    expect(result.reply).toBe("Your recovery is strong.");
    expect(result.presentationBlocks).toEqual([metric]);
  });

  it("fails closed and preserves visible content for malformed proposals", () => {
    const reply = "Answer\n```coach-blocks\nnot json\n```";
    expect(extractCoachPresentation(reply)).toEqual({
      reply,
      presentationBlocks: [],
    });
  });

  it("rejects unknown versions and types", () => {
    expect(parseCoachPresentationBlocks([{ ...metric, version: 2 }])).toEqual([]);
    expect(parseCoachPresentationBlocks([{ ...metric, type: "html" }])).toEqual([]);
  });

  it("rejects a mixed payload rather than partially trusting it", () => {
    expect(parseCoachPresentationBlocks([metric, { ...metric, metrics: [] }])).toEqual([]);
  });

  it("enforces block and point caps and finite numeric values", () => {
    expect(parseCoachPresentationBlocks(Array(MAX_PRESENTATION_BLOCKS + 1).fill(metric))).toEqual([]);
    expect(parseCoachPresentationBlocks([{ ...metric, metrics: [{ ...metric.metrics[0], value: Infinity }] }])).toEqual([]);
    const chart = {
      version: 1,
      type: "chart",
      fallback: "Trend table fallback.",
      title: "HRV",
      labels: Array.from({ length: 101 }, (_, index) => String(index)),
      series: [{ id: "hrv", label: "HRV", unit: "ms", kind: "line", values: Array(101).fill(60) }],
      references: [],
      anomalies: [],
    };
    expect(parseCoachPresentationBlocks([chart])).toEqual([]);
  });

  it("accepts all initial block types", () => {
    const blocks = [
      metric,
      { version: 1, type: "comparison", fallback: "Comparison.", title: "This week", items: [{ label: "HRV", current: 62, baseline: 58, delta: 4, unit: "ms", direction: "up" }] },
      { version: 1, type: "chart", fallback: "Chart.", title: "HRV", labels: ["Mon", "Tue"], series: [{ id: "hrv", label: "HRV", unit: "ms", kind: "line", values: [60, 62] }], references: [{ label: "Baseline", value: 58, unit: "ms" }], anomalies: [{ index: 1, label: "High" }] },
      { version: 1, type: "action_plan", fallback: "Plan.", title: "Next steps", sections: [{ timeframe: "today", items: ["Easy aerobic work"] }] },
      { version: 1, type: "data_freshness", fallback: "Fresh through today.", sources: [{ source: "Whoop", status: "fresh", last_available_date: "2026-08-18" }], sync_available: true },
      { version: 1, type: "workout_plan", fallback: "Workout preview.", title: "Easy run", date: null, exercises: [{ name: "Run", prescription: "30 min zone 2", notes: "Conversational pace" }] },
      { version: 1, type: "evidence", fallback: "Evidence summary.", title: "Evidence", date_range: "Aug 12-18", record_count: 7, missing_days: 0, sources: ["Whoop"], points: ["HRV rose 7%"] },
    ];
    expect(parseCoachPresentationBlocks(blocks)).toHaveLength(7);
  });
});
