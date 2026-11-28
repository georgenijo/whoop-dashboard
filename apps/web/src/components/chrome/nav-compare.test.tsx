import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/compare",
  useSearchParams: () => new URLSearchParams(),
}));

import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";

describe("Compare nav entry (PERIOD_COMPARE)", () => {
  afterEach(cleanup);
  it("is absent from the sidebar by default", () => {
    render(<Sidebar />);
    expect(screen.queryByRole("link", { name: /Compare/ })).toBeNull();
  });

  it("appears in the sidebar when enabled", () => {
    render(<Sidebar compareEnabled />);
    const link = screen.getByRole("link", { name: /Compare/ });
    expect(link.getAttribute("href")).toBe("/compare");
    expect(link.className).toMatch(/active/);
  });

  it("is absent from the mobile More drawer by default and present when enabled", () => {
    const { unmount } = render(<BottomNav />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.queryByRole("link", { name: /Compare/ })).toBeNull();
    unmount();
    render(<BottomNav compareEnabled />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.getByRole("link", { name: /Compare/ }).getAttribute("href")).toBe("/compare");
  });
});
