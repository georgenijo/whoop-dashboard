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

describe("Goals nav entry (GOALS_PAGE)", () => {
  it("Sidebar omits it by default and shows it when enabled", () => {
    const { unmount } = render(<Sidebar />);
    expect(screen.queryByRole("link", { name: /Goals/ })).toBeNull();
    unmount();
    render(<Sidebar showGoals />);
    expect(screen.getByRole("link", { name: /Goals/ }).getAttribute("href")).toBe("/goals");
  });

  it("BottomNav drawer omits it by default and shows it when enabled", () => {
    const { unmount } = render(<BottomNav />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.queryByRole("link", { name: /Goals/ })).toBeNull();
    unmount();
    render(<BottomNav showGoals />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.getByRole("link", { name: /Goals/ }).getAttribute("href")).toBe("/goals");
  });

  it("titles /goals instead of falling back to Overview", () => {
    expect(titleForPath("/goals")).toBe("Goals");
  });
});
