import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./page";

const fetchMock = vi.fn();
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

function setup(insightError: string | null, titleError: string | null) {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === "/api/insights/status") return { ok: true, json: async () => ({ errorClass: insightError, titleErrorClass: titleError }) };
    if (url === "/api/me/anthropic-key") return { ok: true, json: async () => ({
      ...(options?.method === "POST" ? { ok: true } : {}),
      present: options?.method === "POST", masked: null, source: "none", fallback_available: false,
    }) };
    return { ok: false };
  });
  render(<SettingsPage />);
}

describe("Settings background generation failures", () => {
  it("shows a single bad-key notice from title failures, even alongside an insight error", async () => {
    setup("provider_error", "bad_key");
    // A 404 on /api/settings also raises the picker's load-failure alert, so
    // the background-generation notice is asserted by its message text
    // (live-region alerts expose no accessible name in the test DOM).
    expect(await screen.findByText(/Anthropic rejected the current key/)).toBeInTheDocument();
    expect(screen.getAllByText(/restore insights and conversation titles/)).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/insights/status")).toHaveLength(1);
  });
  it("clears the notice after a replacement key is verified", async () => {
    setup(null, "bad_key");
    await screen.findByText(/Anthropic rejected the current key/);
    fireEvent.change(screen.getByLabelText("Personal Anthropic API key"), { target: { value: "sk-ant-replacement-fixture-key" } });
    fireEvent.click(within(screen.getByLabelText("Personal Anthropic API key").parentElement!).getByRole("button", { name: "Use this key" }));
    await waitFor(() => expect(screen.queryByText(/Anthropic rejected the current key/)).not.toBeInTheDocument());
  });
});
