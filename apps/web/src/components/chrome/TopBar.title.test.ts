import { describe, expect, it } from "vitest";
import { titleForPath } from "./TopBar";

describe("titleForPath", () => {
  it("uses the exact title for top-level routes", () => {
    expect(titleForPath("/stats")).toBe("Stats");
    expect(titleForPath("/")).toBe("Overview");
  });

  it("gives nested routes their section's title (issue #430)", () => {
    expect(titleForPath("/stats/HIIT%2FCircuit")).toBe("Stats");
    expect(titleForPath("/workouts/abc-123")).toBe("Workouts");
  });

  it("falls back to Overview for unknown sections", () => {
    expect(titleForPath("/nope/x")).toBe("Overview");
  });

  it("titles /compare instead of falling back to Overview", () => {
    expect(titleForPath("/compare")).toBe("Compare periods");
  });

  it("titles /data-health instead of falling back to Overview", () => {
    expect(titleForPath("/data-health")).toBe("Data health");
  });

  it("titles /year instead of falling back to Overview", () => {
    expect(titleForPath("/year")).toBe("Year in Review");
  });

  it("titles /day instead of falling back to Overview", () => {
    expect(titleForPath("/day")).toBe("Day detail");
    expect(titleForPath("/day/2026-11-27")).toBe("Day detail");
  });

  it("titles /sleep/stages without changing /sleep", () => {
    expect(titleForPath("/sleep/stages")).toBe("Sleep stages");
    expect(titleForPath("/sleep")).toBe("Sleep");
  });

  it("titles /sleep/regularity without changing /sleep", () => {
    expect(titleForPath("/sleep/regularity")).toBe("Sleep regularity");
    expect(titleForPath("/sleep")).toBe("Sleep");
  });

  it("titles every page added in the Nov 27 frontier batch, never Overview", () => {
    const pages: Record<string, string> = {
      "/weekly": "Weekly review",
      "/compare": "Compare periods",
      "/records": "Records",
      "/alerts": "Alerts",
      "/report": "Health report",
      "/load": "Training Load",
      "/year": "Year in Review",
      "/day": "Day detail",
      "/day/2026-11-27": "Day detail",
      "/stats/Running": "Stats",
      "/workouts/abc-123": "Workouts",
    };
    for (const [path, title] of Object.entries(pages)) {
      expect(titleForPath(path)).toBe(title);
    }
  });
});
