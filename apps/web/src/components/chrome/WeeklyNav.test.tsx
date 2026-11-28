import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(cleanup);

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";

describe("Weekly review nav entry", () => {
  it("Sidebar omits it by default and shows it when enabled", () => {
    const { unmount } = render(<Sidebar />);
    expect(screen.queryByRole("link", { name: /Weekly review/ })).toBeNull();
    const linksOff = screen.getAllByRole("link").length;
    unmount();

    render(<Sidebar showWeekly />);
    expect(screen.getByRole("link", { name: /Weekly review/ })).toHaveAttribute("href", "/weekly");
    expect(screen.getAllByRole("link")).toHaveLength(linksOff + 1);
  });

  it("BottomNav drawer omits it by default and shows it when enabled", () => {
    const { unmount } = render(<BottomNav />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.queryByRole("link", { name: /Weekly review/ })).toBeNull();
    unmount();

    render(<BottomNav showWeekly />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.getByRole("link", { name: /Weekly review/ })).toHaveAttribute("href", "/weekly");
  });
});
