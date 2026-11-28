import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";

afterEach(cleanup);

describe("Training Load nav entry (TRAINING_LOAD)", () => {
  it("Sidebar omits it by default and shows it when enabled", () => {
    const { unmount } = render(<Sidebar />);
    expect(screen.queryByRole("link", { name: /^Load$/ })).toBeNull();
    unmount();
    render(<Sidebar showTrainingLoad />);
    expect(screen.getByRole("link", { name: /^Load$/ }).getAttribute("href")).toBe("/load");
  });

  it("BottomNav drawer omits it by default and shows it when enabled", () => {
    const { unmount } = render(<BottomNav />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.queryByRole("link", { name: /^Load$/ })).toBeNull();
    unmount();
    render(<BottomNav showTrainingLoad />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.getByRole("link", { name: /^Load$/ }).getAttribute("href")).toBe("/load");
  });
});
