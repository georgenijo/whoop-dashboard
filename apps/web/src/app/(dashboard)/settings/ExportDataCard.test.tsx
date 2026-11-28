import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));

import ExportDataCard from "./ExportDataCard";
import SettingsLayout from "./layout";

afterEach(() => {
  cleanup();
  delete process.env.DATA_EXPORT;
});

describe("ExportDataCard", () => {
  it("is a plain GET form to /api/export with dataset, format and dates", () => {
    const { container } = render(<ExportDataCard />);
    expect(screen.getByRole("heading", { name: "Export my data" })).toBeTruthy();
    const form = container.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/api/export");

    const kind = container.querySelector<HTMLSelectElement>('select[name="kind"]')!;
    expect([...kind.options].map((o) => o.value)).toEqual(["all", "recovery", "sleep", "cycles", "workouts", "steps"]);
    expect(kind.value).toBe("all");
    const format = container.querySelector<HTMLSelectElement>('select[name="format"]')!;
    expect([...format.options].map((o) => o.value)).toEqual(["csv", "json"]);
    expect(container.querySelector('input[type="date"][name="from"]')).toBeTruthy();
    expect(container.querySelector('input[type="date"][name="to"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download/ }).getAttribute("type")).toBe("submit");
  });

  it("offers <a download> quick links for the default window", () => {
    render(<ExportDataCard />);
    const csv = screen.getByRole("link", { name: /CSV/ });
    expect(csv.getAttribute("href")).toBe("/api/export?kind=all&format=csv");
    expect(csv.hasAttribute("download")).toBe(true);
    expect(screen.getByRole("link", { name: /JSON/ }).getAttribute("href")).toBe("/api/export?kind=all&format=json");
  });
});

describe("settings layout flag gate", () => {
  async function renderLayout() {
    const el = await SettingsLayout({ children: <p>settings page</p> });
    return render(<>{el}</>);
  }

  it.each([undefined, "0", "true"])("DATA_EXPORT=%s renders only the page", async (v) => {
    if (v !== undefined) process.env.DATA_EXPORT = v;
    const { container } = await renderLayout();
    expect(container.innerHTML).toBe("<p>settings page</p>");
    expect(screen.queryByText("Export my data")).toBeNull();
  });

  it("DATA_EXPORT=1 appends the card after the page", async () => {
    process.env.DATA_EXPORT = "1";
    await renderLayout();
    expect(screen.getByText("settings page")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Export my data" })).toBeTruthy();
  });
});
