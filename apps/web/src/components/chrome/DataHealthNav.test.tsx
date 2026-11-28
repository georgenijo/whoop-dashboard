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

describe("Data health nav entry (DATA_HEALTH)", () => {
  it("Sidebar omits it by default and shows it before Logs when enabled", () => {
    const { unmount } = render(<Sidebar />);
    expect(screen.queryByRole("link", { name: /Data health/ })).toBeNull();
    const before = hrefs();
    unmount();
    render(<Sidebar showDataHealth />);
    expect(screen.getByRole("link", { name: /Data health/ }).getAttribute("href")).toBe("/data-health");
    const after = hrefs();
    expect(after.filter((h) => h !== "/data-health")).toEqual(before);
    expect(after.indexOf("/data-health")).toBe(after.indexOf("/logs") - 1);
  });

  it("composes with the health report entry", () => {
    render(<Sidebar showDataHealth showReport />);
    const after = hrefs();
    const order = ["/data-health", "/logs", "/perf", "/report", "/settings"];
    expect(after.filter((h) => order.includes(h!))).toEqual(order);
  });

  it("BottomNav drawer omits it by default and shows it when enabled", () => {
    const { unmount } = render(<BottomNav />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.queryByRole("link", { name: /Data health/ })).toBeNull();
    unmount();
    render(<BottomNav showDataHealth />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.getByRole("link", { name: /Data health/ }).getAttribute("href")).toBe("/data-health");
  });
});
