import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
let pathname = "/";
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname,
  useSearchParams: () => search,
}));

import CommandPalette, { isPaletteShortcut } from "./CommandPalette";
import TopBar from "./TopBar";

const today = () => "2026-11-27";

function pressCmdK(opts: { ctrlKey?: boolean; metaKey?: boolean } = { metaKey: true }) {
  act(() => {
    fireEvent.keyDown(window, { key: "k", ...opts });
  });
}

beforeEach(() => {
  push.mockReset();
  pathname = "/";
  search = new URLSearchParams();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("isPaletteShortcut", () => {
  it("matches Cmd-K and Ctrl-K only", () => {
    const base = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
    expect(isPaletteShortcut({ ...base, key: "k", metaKey: true })).toBe(true);
    expect(isPaletteShortcut({ ...base, key: "K", ctrlKey: true })).toBe(true);
    expect(isPaletteShortcut({ ...base, key: "k" })).toBe(false);
    expect(isPaletteShortcut({ ...base, key: "k", metaKey: true, shiftKey: true })).toBe(false);
    expect(isPaletteShortcut({ ...base, key: "j", metaKey: true })).toBe(false);
  });
});

describe("CommandPalette", () => {
  it("renders only the trigger button while closed", () => {
    render(<CommandPalette today={today} />);
    const trigger = screen.getByRole("button", { name: "Quick jump" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on Cmd-K and Ctrl-K, focuses the combobox, toggles closed", () => {
    render(<CommandPalette today={today} />);
    pressCmdK();
    const dialog = screen.getByRole("dialog", { name: "Quick jump" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const input = screen.getByRole("combobox");
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    pressCmdK();
    expect(screen.queryByRole("dialog")).toBeNull();
    pressCmdK({ ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("lists pages and actions; aria-activedescendant tracks arrow keys with wrap", () => {
    render(<CommandPalette today={today} />);
    pressCmdK();
    const input = screen.getByRole("combobox");
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Overview");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", options[1].id);
    expect(options[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveAttribute("aria-activedescendant", options[options.length - 1].id);
  });

  it("filters as you type and navigates on Enter", () => {
    render(<CommandPalette today={today} />);
    pressCmdK();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "sle" } });
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Sleep");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/sleep");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("turns a typed date into a range-scoped jump", () => {
    render(<CommandPalette today={today} />);
    pressCmdK();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "2026-11-02" } });
    const first = screen.getAllByRole("option")[0];
    expect(first).toHaveTextContent("Overview around Mon, Nov 2");
    expect(first).toHaveTextContent("last 30 days");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // Recovery
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/recovery?range=30d");
  });

  it("preserves the current range on dashboard jumps", () => {
    pathname = "/sleep";
    search = new URLSearchParams("range=90d");
    render(<CommandPalette today={today} />);
    pressCmdK();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "strain" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/strain?range=90d");
  });

  it("shows an empty state and Enter does nothing", () => {
    render(<CommandPalette today={today} />);
    pressCmdK();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "zzzzqx" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(input).not.toHaveAttribute("aria-activedescendant");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("status")).toHaveTextContent("No matches");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).not.toHaveBeenCalled();
  });

  it("Esc closes and restores focus to the opener", async () => {
    render(<CommandPalette today={today} />);
    const trigger = screen.getByRole("button", { name: "Quick jump" });
    trigger.focus();
    fireEvent.click(trigger);
    const input = screen.getByRole("combobox");
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { await Promise.resolve(); });
    expect(trigger).toHaveFocus();
  });

  it("traps Tab inside the dialog", () => {
    render(<CommandPalette today={today} />);
    pressCmdK();
    const input = screen.getByRole("combobox");
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => { input.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(input).toHaveFocus();
  });

  it("clicking the backdrop closes; clicking an option navigates", () => {
    render(<CommandPalette today={today} />);
    pressCmdK();
    fireEvent.mouseDown(screen.getByTestId("command-palette-overlay"));
    expect(screen.queryByRole("dialog")).toBeNull();

    pressCmdK();
    const coach = screen.getAllByRole("option").find((o) => o.textContent?.startsWith("Coach"))!;
    fireEvent.click(coach);
    expect(push).toHaveBeenCalledWith("/coach");
  });

  it("removes its key listener on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<CommandPalette today={today} />);
    unmount();
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function));
  });

  it("makes no network calls", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<CommandPalette today={today} />);
    pressCmdK();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "yesterday" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("TopBar trailing slot (flag wiring)", () => {
  it("renders no palette trigger and ignores Cmd-K without the slot (flag off)", () => {
    render(<TopBar />);
    expect(screen.queryByRole("button", { name: "Quick jump" })).toBeNull();
    pressCmdK();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("renders the palette trigger when passed (flag on)", () => {
    render(<TopBar trailing={<CommandPalette today={today} />} />);
    expect(screen.getByRole("button", { name: "Quick jump" })).toBeInTheDocument();
    pressCmdK();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
