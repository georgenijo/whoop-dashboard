import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buildTodayCard } from "@/lib/share/todayCard";
import { fullDay, input } from "@/lib/share/__fixtures__/shareRows";
import ShareTodayView from "./ShareTodayView";
import ShareCard from "./ShareCard";

afterEach(cleanup);

const tileEl = (key: string) => document.querySelector(`[data-share-tile="${key}"]`) as HTMLElement;

describe("ShareTodayView", () => {
  it("renders every section with numbers and the recap", () => {
    render(<ShareTodayView model={buildTodayCard(fullDay())} />);
    expect(screen.getByText("Friday, Nov 27, 2026")).toBeTruthy();
    expect(tileEl("recovery").textContent).toContain("68%");
    expect(tileEl("recovery").textContent).toContain("Green");
    expect(tileEl("sleep").textContent).toContain("7h 42m");
    expect(tileEl("strain").textContent).toContain("12.4");
    expect(tileEl("hrv").textContent).toContain("64 ms");
    expect(tileEl("rhr").textContent).toContain("52 bpm");
    expect(document.querySelector("[data-share-recap]")!.textContent).toBe(
      "Green recovery at 68%, 7h 42m asleep, strain 12.4 so far with 1 workout.",
    );
  });

  it("links the toggles and the download to the same options", () => {
    render(<ShareTodayView model={buildTodayCard(fullDay())} />);
    expect(screen.getByRole("link", { name: "Hide numbers" }).getAttribute("href")).toBe("/share/today?hide=1");
    expect(screen.getByRole("link", { name: "Light" }).getAttribute("href")).toBe("/share/today?theme=light");
    expect(screen.getByRole("link", { name: "Dark" }).getAttribute("aria-current")).toBe("true");
    const dl = screen.getByRole("link", { name: "Download PNG" });
    expect(dl.getAttribute("href")).toBe("/api/share/today");
    expect(dl.getAttribute("download")).toBe("coach-day-2026-11-27.png");
  });

  it("hide-numbers mode shows bands only and no digits on the card beyond the date", () => {
    render(<ShareTodayView model={buildTodayCard(fullDay("2026-11-27", { hideNumbers: true, theme: "light" }))} />);
    const card = document.querySelector("[data-theme-card]") as HTMLElement;
    expect(card.getAttribute("data-theme-card")).toBe("light");
    const text = card.textContent!.replace("Friday, Nov 27, 2026", "");
    expect(text).not.toMatch(/\d/);
    // The band sits inside the ring once, not repeated beside it.
    expect(tileEl("recovery").textContent!.match(/Green/g)).toHaveLength(1);
    expect(tileEl("sleep").textContent).toContain("Optimal");
    expect(card.textContent).toContain("Numbers hidden");
    expect(screen.getByRole("link", { name: "Show numbers" }).getAttribute("href")).toBe("/share/today?theme=light");
    expect(screen.getByRole("link", { name: "Download PNG" }).getAttribute("href")).toBe("/api/share/today?hide=1&theme=light");
  });

  it("an empty day shows placeholders instead of breaking", () => {
    render(<ShareTodayView model={buildTodayCard(input())} />);
    expect(screen.getAllByText("Not synced yet").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText("Nothing has synced for today yet.")).toBeTruthy();
  });

  it("never renders identity, ids or sport names", () => {
    render(<ShareTodayView model={buildTodayCard(fullDay())} />);
    const card = document.querySelector("[data-theme-card]")!.textContent!;
    expect(card).not.toMatch(/Running|w1|@|user/i);
  });
});

describe("ShareCard", () => {
  it("image mode is a fixed 4:5 frame at the given scale", () => {
    const { container } = render(<ShareCard model={buildTodayCard(fullDay())} scale={2} forImage />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe("1080px");
    expect(root.style.height).toBe("1350px");
  });

  it("theme sets the card colours", () => {
    const { container, rerender } = render(<ShareCard model={buildTodayCard(fullDay())} />);
    const dark = (container.firstElementChild as HTMLElement).style.background;
    rerender(<ShareCard model={buildTodayCard(fullDay("2026-11-27", { theme: "light" }))} />);
    expect((container.firstElementChild as HTMLElement).style.background).not.toBe(dark);
  });
});
