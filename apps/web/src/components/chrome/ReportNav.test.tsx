import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(cleanup);

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";

describe("Health report nav entry", () => {
  it("Sidebar omits it by default and shows it when enabled", () => {
    const { unmount } = render(<Sidebar />);
    expect(screen.queryByRole("link", { name: /Health report/ })).toBeNull();
    const linksOff = screen.getAllByRole("link").map((l) => l.getAttribute("href"));
    unmount();

    render(<Sidebar showReport />);
    expect(screen.getByRole("link", { name: /Health report/ })).toHaveAttribute("href", "/report");
    const linksOn = screen.getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(linksOn.filter((h) => h !== "/report")).toEqual(linksOff);
  });

  it("BottomNav drawer omits it by default and shows it when enabled", () => {
    const { unmount } = render(<BottomNav />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.queryByRole("link", { name: /Health report/ })).toBeNull();
    unmount();

    render(<BottomNav showReport />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.getByRole("link", { name: /Health report/ })).toHaveAttribute("href", "/report");
  });
});
