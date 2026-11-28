import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import CompareView from "./CompareView";
import {
  PRESETS,
  comparePeriods,
  resolveComparison,
  type PeriodData,
} from "@/lib/analytics/comparePeriods";

const EMPTY: PeriodData = { recovery: [], sleep: [], cycles: [], workouts: [] };

function renderView(params: Record<string, string>, dataA: PeriodData, dataB: PeriodData) {
  const resolved = resolveComparison(params, "2026-11-27");
  const rows = comparePeriods(resolved.a, resolved.b, dataA, dataB);
  return render(<CompareView resolved={resolved} rows={rows} today="2026-11-27" presets={PRESETS} />);
}

describe("CompareView", () => {
  afterEach(cleanup);
  it("renders a plain GET form with the resolved dates and preset links", () => {
    const { container } = renderView({ preset: "month" }, EMPTY, EMPTY);
    const form = container.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/compare");
    expect((form.querySelector('input[name="a_from"]') as HTMLInputElement).value).toBe("2026-11-01");
    expect((form.querySelector('input[name="b_to"]') as HTMLInputElement).value).toBe("2026-10-31");
    const active = screen.getByRole("link", { name: "This month vs last month" });
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.getAttribute("href")).toBe("/compare?preset=month");
    expect(screen.getByLabelText("Notes").textContent).toMatch(/27 vs 31 days/);
  });

  it("shows every metric as no-data when there is nothing to compare", () => {
    const { container } = renderView({}, EMPTY, EMPTY);
    const rows = container.querySelectorAll("li[data-metric]");
    expect(rows).toHaveLength(9);
    rows.forEach((r) => expect(r.getAttribute("data-verdict")).toBe("no-data"));
    expect(container.querySelectorAll("path")).toHaveLength(0);
  });

  it("renders values, arrows that respect good direction, and paired sparklines", () => {
    const dataA: PeriodData = {
      ...EMPTY,
      recovery: [
        { date: "2026-11-20", recovery_score: 75, hrv: 70, rhr: 48 },
        { date: "2026-11-21", recovery_score: 71, hrv: 66, rhr: 49 },
      ],
    };
    const dataB: PeriodData = {
      ...EMPTY,
      recovery: [{ date: "2026-10-20", recovery_score: 60, hrv: 67, rhr: 52 }],
    };
    const { container } = renderView({}, dataA, dataB);
    const rec = container.querySelector('li[data-metric="recovery"]') as HTMLElement;
    expect(rec.getAttribute("data-verdict")).toBe("better");
    expect(within(rec).getByText("↑")).toBeTruthy();
    expect(rec.textContent).toMatch(/\+13 \(\+22%\)/);
    expect(rec.textContent).toMatch(/2 \/ 1 days scored/);
    expect(rec.querySelector('path[data-series="a"]')).not.toBeNull();
    expect(rec.querySelector('path[data-series="b"]')).not.toBeNull();

    const rhr = container.querySelector('li[data-metric="rhr"]') as HTMLElement;
    expect(rhr.getAttribute("data-verdict")).toBe("better");
    expect(within(rhr).getByText("↓")).toBeTruthy();

    const hrv = container.querySelector('li[data-metric="hrv"]') as HTMLElement;
    expect(hrv.getAttribute("data-verdict")).toBe("same");
    expect(within(hrv).getByText("about the same")).toBeTruthy();
  });

  it("surfaces validation errors", () => {
    renderView({ a_from: "2026-02-30", a_to: "2026-03-01", b_from: "2026-01-01", b_to: "2026-01-05" }, EMPTY, EMPTY);
    expect(screen.getByRole("alert").textContent).toMatch(/Period A/);
  });
});
