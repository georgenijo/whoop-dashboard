import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";
import { titleForPath } from "./TopBar";

afterEach(cleanup);

describe("Baselines nav entry (BASELINES_PAGE)", () => {
  it("Sidebar omits it by default and shows it when enabled", () => {
    const { unmount } = render(<Sidebar />);
    expect(screen.queryByRole("link", { name: /Baselines/ })).toBeNull();
    unmount();
    render(<Sidebar showBaselines />);
    expect(screen.getByRole("link", { name: /Baselines/ }).getAttribute("href")).toBe("/baselines");
  });

  it("BottomNav drawer omits it by default and shows it when enabled", () => {
    const { unmount } = render(<BottomNav />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.queryByRole("link", { name: /Baselines/ })).toBeNull();
    unmount();
    render(<BottomNav showBaselines />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.getByRole("link", { name: /Baselines/ }).getAttribute("href")).toBe("/baselines");
  });

  it("titles /baselines", () => {
    expect(titleForPath("/baselines")).toBe("Your baselines");
  });
});
