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

// A 404 on /api/settings also raises the picker's load-failure alert, so more
// than one role="alert" element can be on the page. Select the
// background-generation notice among them by message text, and require that it
// really is a live-region alert (not merely text somewhere on the page).
async function findBackgroundAlert(message: RegExp): Promise<HTMLElement> {
  return waitFor(() => {
    const match = screen.getAllByRole("alert").find((el) => message.test(el.textContent ?? ""));
    if (!match) throw new Error(`no role="alert" element matching ${message}`);
    return match;
  });
}

describe("Settings background generation failures", () => {
  it("shows a single bad-key notice from title failures, even alongside an insight error", async () => {
    setup("provider_error", "bad_key");
    const notice = await findBackgroundAlert(/Anthropic rejected the current key/);
    expect(notice).toHaveAttribute("role", "alert");
    expect(notice).toHaveTextContent("Anthropic rejected the current key");
    expect(screen.getAllByText(/restore insights and conversation titles/)).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/insights/status")).toHaveLength(1);
  });
  it("clears the notice after a replacement key is verified", async () => {
    setup(null, "bad_key");
    await findBackgroundAlert(/Anthropic rejected the current key/);
    fireEvent.change(screen.getByLabelText("Personal Anthropic API key"), { target: { value: "sk-ant-replacement-fixture-key" } });
    fireEvent.click(within(screen.getByLabelText("Personal Anthropic API key").parentElement!).getByRole("button", { name: "Use this key" }));
    await waitFor(() => expect(screen.queryByText(/Anthropic rejected the current key/)).not.toBeInTheDocument());
  });
});

describe("Settings load Retry and the instructions draft", () => {
  function setupWithSettings(settingsResponses: Array<() => { ok: boolean; json?: () => Promise<unknown> }>) {
    vi.stubGlobal("fetch", fetchMock);
    let settingsCalls = 0;
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === "/api/settings" && options?.method !== "POST") {
        const next = settingsResponses[Math.min(settingsCalls, settingsResponses.length - 1)];
        settingsCalls += 1;
        return next();
      }
      return { ok: false };
    });
    render(<SettingsPage />);
  }
  const failed = () => ({ ok: false });
  const loaded = (system_prompt: string, model_pref: string) => () => ({
    ok: true,
    json: async () => ({ system_prompt, model_pref }),
  });

  it("keeps an edited instructions draft and its unsaved state when Retry succeeds", async () => {
    setupWithSettings([failed, loaded("server instructions", "anthropic:claude-opus-4-6")]);

    const retry = await within(await screen.findByTestId("model-load-error")).findByRole("button", { name: "Retry" });
    const textarea = screen.getByLabelText("Coach instructions") as HTMLTextAreaElement;
    expect(screen.getByLabelText("Coach model")).toBeDisabled();

    fireEvent.change(textarea, { target: { value: "my edited draft" } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    fireEvent.click(retry);

    // Recovery: the picker enables with the server's selection...
    await waitFor(() => expect(screen.getByLabelText("Coach model")).toBeEnabled());
    expect((screen.getByLabelText("Coach model") as HTMLSelectElement).value).toBe("anthropic:claude-opus-4-6");
    expect(screen.queryByTestId("model-load-error")).not.toBeInTheDocument();
    // ...but the draft was not overwritten and is still unsaved.
    expect(textarea.value).toBe("my edited draft");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("still populates instructions on the initial load and on Retry when nothing was edited", async () => {
    setupWithSettings([loaded("server instructions", "anthropic:claude-opus-4-6")]);
    await waitFor(() => expect(screen.getByLabelText("Coach model")).toBeEnabled());
    expect((screen.getByLabelText("Coach instructions") as HTMLTextAreaElement).value).toBe("server instructions");
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("adopts the server instructions on Retry when the draft was left untouched", async () => {
    setupWithSettings([failed, loaded("server instructions", "anthropic:claude-opus-4-6")]);
    fireEvent.click(await within(await screen.findByTestId("model-load-error")).findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByLabelText("Coach model")).toBeEnabled());
    expect((screen.getByLabelText("Coach instructions") as HTMLTextAreaElement).value).toBe("server instructions");
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });
});
