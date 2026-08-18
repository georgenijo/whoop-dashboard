import { describe, expect, it } from "vitest";
import { parseCoachVisualizations, parseMermaidXyChart } from "./visualization";

const HRV_CHART = `xychart-beta
  title "Morning HRV (ms)"
  x-axis ["7/19","7/22","7/25"]
  y-axis "ms" 25 --> 55
  line [43,45,30]`;

describe("Coach visualization parsing", () => {
  it("parses the xychart emitted in Coach thread 150", () => {
    expect(parseMermaidXyChart(HRV_CHART)).toEqual({
      type: "line",
      title: "Morning HRV (ms)",
      unit: "ms",
      labels: ["7/19", "7/22", "7/25"],
      values: [43, 45, 30],
      yMin: 25,
      yMax: 55,
    });
  });

  it("extracts valid charts while preserving surrounding markdown", () => {
    const segments = parseCoachVisualizations(
      `**Trend summary.**\n\n\`\`\`mermaid\n${HRV_CHART}\n\`\`\`\n\n**Takeaway:** Sleep more.`,
    );

    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ type: "markdown", content: "**Trend summary.**\n\n" });
    expect(segments[1].type).toBe("chart");
    expect(segments[2]).toEqual({
      type: "markdown",
      content: "\n\n**Takeaway:** Sleep more.",
    });
  });

  it("leaves malformed and unsupported Mermaid untouched", () => {
    const malformed = "```mermaid\nxychart-beta\nx-axis [\"a\"]\nline [1,2]\n```";
    expect(parseCoachVisualizations(malformed)).toEqual([
      { type: "markdown", content: malformed },
    ]);
    expect(parseMermaidXyChart("flowchart LR\nA --> B")).toBeNull();
  });
});
