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
});
