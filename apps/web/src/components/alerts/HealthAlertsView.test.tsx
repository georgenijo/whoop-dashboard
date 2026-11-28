import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

afterEach(cleanup);
import HealthAlertsView, { shortDate } from "./HealthAlertsView";
import type { HealthAlertsResult } from "@/lib/analytics/healthAlerts";

const clearChecks: HealthAlertsResult["checks"] = [
  { kind: "freshness", label: "Data freshness", status: "clear" },
  { kind: "illness", label: "Illness signal", status: "clear" },
  { kind: "overtraining", label: "Overtraining", status: "insufficient" },
];

describe("HealthAlertsView", () => {
  it("empty state says nothing to flag and lists the checks", () => {
    render(<HealthAlertsView result={{ alerts: [], checks: clearChecks, asOf: "2026-11-27" }} />);
    expect(screen.getByTestId("alerts-empty")).toHaveTextContent("Nothing to flag");
    expect(screen.getByTestId("alerts-empty")).toHaveTextContent("2 of 3 checks are within your usual range.");
    expect(screen.getByText(/Based on data through Nov 27/)).toBeInTheDocument();
    expect(screen.getByText(/guidance, not medical advice/)).toBeInTheDocument();
    const checks = screen.getByRole("list", { name: "Checks" });
    expect(within(checks).getByText("not enough data")).toBeInTheDocument();
  });

  it("renders alerts in order with severity, numbers, since-when and help", () => {
    const { container } = render(
      <HealthAlertsView
        result={{
          asOf: "2026-11-27",
          checks: clearChecks,
          alerts: [
            {
              kind: "illness", severity: "act", title: "Early illness pattern",
              detail: "2 of 3 signals are off your 14-day baseline: resting HR +4.2 bpm, HRV −14%.",
              since: "2026-11-26", days: 2, help: "Keep strain light.", href: "/recovery",
            },
            {
              kind: "sleep_debt", severity: "info", title: "Sleep debt 1 h",
              detail: "Whoop added 1 h to your sleep need.", since: "2026-11-27", days: 1,
              help: "Earlier bedtime.", href: "/sleep",
            },
          ],
        }}
      />,
    );
    const items = within(screen.getByRole("list", { name: "Health alerts" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Early illness pattern");
    expect(items[0]).toHaveTextContent("Act");
    expect(items[0]).toHaveTextContent("resting HR +4.2 bpm");
    expect(items[0]).toHaveTextContent("since Nov 26 · 2 days");
    expect(items[0]).toHaveTextContent("What usually helps: Keep strain light.");
    expect(items[1]).toHaveTextContent("since Nov 27");
    expect(items[1]).not.toHaveTextContent("1 days");
    expect(within(items[1]).getByRole("link")).toHaveAttribute("href", "/sleep");
    expect(container.querySelector('[data-severity="act"]')).not.toBeNull();
    expect(screen.queryByTestId("alerts-empty")).toBeNull();
  });

  it("shortDate is timezone-independent", () => {
    expect(shortDate("2026-01-01")).toBe("Jan 1");
    expect(shortDate("2026-12-31")).toBe("Dec 31");
  });
});
