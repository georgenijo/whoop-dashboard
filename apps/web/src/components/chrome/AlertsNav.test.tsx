import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(cleanup);

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";

describe("Health Alerts nav entry", () => {
  it("Sidebar omits it unless the server passes alerts", () => {
    const { unmount } = render(<Sidebar />);
    expect(screen.queryByRole("link", { name: /Alerts/ })).toBeNull();
    unmount();
    render(<Sidebar alerts={{ count: 0 }} />);
    expect(screen.getByRole("link", { name: "Alerts" })).toHaveAttribute("href", "/alerts");
    expect(document.querySelector(".sb-badge")).toBeNull();
  });

  it("Sidebar shows a count badge when there are watch/act alerts", () => {
    render(<Sidebar alerts={{ count: 2 }} />);
    expect(screen.getByLabelText("2 alerts")).toHaveTextContent("2");
  });

  it("BottomNav adds Alerts to the More drawer only when enabled", () => {
    const { unmount } = render(<BottomNav />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.queryByRole("link", { name: "Alerts" })).toBeNull();
    unmount();
    render(<BottomNav showAlerts />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.getByRole("link", { name: "Alerts" })).toHaveAttribute("href", "/alerts");
  });
});
