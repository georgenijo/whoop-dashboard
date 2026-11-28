import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";

afterEach(cleanup);

describe("Records nav entry (RECORDS_PAGE)", () => {
  it("Sidebar omits it by default and shows it when enabled", () => {
    const { unmount } = render(<Sidebar />);
    expect(screen.queryByRole("link", { name: /Records/ })).toBeNull();
    unmount();
    render(<Sidebar showRecords />);
    expect(screen.getByRole("link", { name: /Records/ }).getAttribute("href")).toBe("/records");
  });

  it("BottomNav drawer omits it by default and shows it when enabled", () => {
    const { unmount } = render(<BottomNav />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.queryByRole("link", { name: /Records/ })).toBeNull();
    unmount();
    render(<BottomNav showRecords />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.getByRole("link", { name: /Records/ }).getAttribute("href")).toBe("/records");
  });
});
