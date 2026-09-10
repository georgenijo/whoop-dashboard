import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CoachMessageActions from "./CoachMessageActions";

function setNavigatorProperty(key: "clipboard" | "share" | "canShare", value: unknown) {
  Object.defineProperty(navigator, key, {
    configurable: true,
    value,
  });
}

describe("CoachMessageActions", () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    writeText.mockResolvedValue(undefined);
    setNavigatorProperty("clipboard", { writeText });
    setNavigatorProperty("share", undefined);
    setNavigatorProperty("canShare", undefined);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("groups one labeled Copy and Share control row", () => {
    render(<CoachMessageActions text="A concise answer." />);

    const actions = screen.getByRole("group", { name: "Message actions" });
    expect(actions).toHaveClass("coach-message-actions");
    expect(within(actions).getAllByRole("button")).toHaveLength(2);
    expect(within(actions).getByRole("button", { name: "Copy" })).toHaveClass("coach-message-action");
    expect(within(actions).getByRole("button", { name: "Share" })).toHaveClass("coach-message-action");
  });

  it("copies the answer and only reports success after the write completes", async () => {
    let finishCopy: (() => void) | undefined;
    writeText.mockImplementation(() => new Promise<void>((resolve) => {
      finishCopy = resolve;
    }));
    render(<CoachMessageActions text="Recovery is trending up." />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("Recovery is trending up.");

    finishCopy?.();
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("clears the copied-label timer when the row unmounts", async () => {
    vi.useFakeTimers();
    const clearTimeout = vi.spyOn(window, "clearTimeout");
    const { unmount } = render(<CoachMessageActions text="Recovery is trending up." />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    unmount();
    expect(clearTimeout).toHaveBeenCalled();
  });

  it("does not create copied feedback after an in-flight write outlives the row", async () => {
    let finishCopy: (() => void) | undefined;
    writeText.mockImplementation(() => new Promise<void>((resolve) => {
      finishCopy = resolve;
    }));
    const setTimeout = vi.spyOn(window, "setTimeout");
    const { unmount } = render(<CoachMessageActions text="Recovery is trending up." />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    unmount();
    await act(async () => {
      finishCopy?.();
      await Promise.resolve();
    });

    expect(setTimeout).not.toHaveBeenCalled();
  });

  it("falls back to copying when native sharing is unavailable", async () => {
    render(<CoachMessageActions text="Keep today easy." />);

    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("Keep today easy.");
  });

  it("handles a canceled native share without showing an error", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("Canceled", "AbortError"));
    setNavigatorProperty("share", share);
    render(<CoachMessageActions text="Take a rest day." />);

    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(share).toHaveBeenCalledWith({
      title: "Coach summary",
      text: "Take a rest day.",
    }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a share failure and clears it when a retry succeeds", async () => {
    const share = vi.fn()
      .mockRejectedValueOnce(new Error("Share failed"))
      .mockResolvedValueOnce(undefined);
    setNavigatorProperty("share", share);
    render(<CoachMessageActions text="Hydrate before training." />);

    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Couldn't share. Try again.");

    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a rejected clipboard write and allows a successful retry", async () => {
    writeText.mockRejectedValueOnce(new Error("Permission denied"));
    render(<CoachMessageActions text="Sleep a little earlier." />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Couldn't copy. Try again.");

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
