import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CoachContextMeter from "./CoachContextMeter";

afterEach(cleanup);

describe("CoachContextMeter (issue #608)", () => {
  it("shows used / limit with an accessible exact value", () => {
    render(<CoachContextMeter tokens={42_123} window={200_000} approximate={false} />);
    const meter = screen.getByRole("meter", { name: "Context window" });
    expect(meter).toHaveTextContent("42k / 200k");
    expect(meter).toHaveAttribute("aria-valuenow", "42123");
    expect(meter).toHaveAttribute("aria-valuetext", "42,123 of 200,000 tokens (21%)");
    expect(meter.className).toContain("is-ok");
  });

  it("marks approximate figures with ~", () => {
    render(<CoachContextMeter tokens={9_000} window={200_000} approximate />);
    expect(screen.getByRole("meter")).toHaveTextContent("~9k / 200k");
  });

  it("goes amber at 75% and red at 90%", () => {
    const { rerender } = render(
      <CoachContextMeter tokens={150_000} window={200_000} approximate={false} />,
    );
    expect(screen.getByRole("meter").className).toContain("is-warn");
    rerender(<CoachContextMeter tokens={185_000} window={200_000} approximate={false} />);
    expect(screen.getByRole("meter").className).toContain("is-danger");
  });
});
