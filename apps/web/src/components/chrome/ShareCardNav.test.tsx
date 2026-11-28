import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";

afterEach(cleanup);

const hrefs = () => screen.getAllByRole("link").map((a) => a.getAttribute("href"));

describe("Share today nav entry (SHARE_CARD)", () => {
  it("Sidebar omits it by default and appends it to the main group when enabled", () => {
    const { unmount } = render(<Sidebar />);
    expect(screen.queryByRole("link", { name: /Share today/ })).toBeNull();
    const before = hrefs();
    unmount();
    render(<Sidebar showShareCard />);
    expect(screen.getByRole("link", { name: /Share today/ }).getAttribute("href")).toBe("/share/today");
    const after = hrefs();
    expect(after.filter((h) => h !== "/share/today")).toEqual(before);
    expect(after.indexOf("/share/today")).toBe(after.indexOf("/stats") + 1);
  });

  it("BottomNav drawer omits it by default and shows it when enabled", () => {
    const { unmount } = render(<BottomNav />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.queryByRole("link", { name: /Share today/ })).toBeNull();
    unmount();
    render(<BottomNav showShareCard />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.getByRole("link", { name: /Share today/ }).getAttribute("href")).toBe("/share/today");
  });
});
