// @vitest-environment jsdom
// Issue #587 hydration regression: the Settings page's initial Coach-model
// selection must be identical on the server and in the browser. Unlike
// COACH_DEFAULT_MODEL (a server-only env var), the initial value must not
// depend on it — otherwise the browser's first render diverges from the
// server's HTML and hydration repairs it with a mismatch error.
import { act, cleanup, waitFor } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./page";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  fetchMock.mockImplementation((url: RequestInfo | URL) => {
    if (String(url) === "/api/settings") {
      // Mirrors GET /api/settings server-side: parseModelPref resolves the
      // effective default — the COACH_DEFAULT_MODEL override included.
      return Promise.resolve(Response.json({
        system_prompt: "",
        model_pref: "anthropic:claude-opus-4-6",
      }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Settings page hydration with a server-only default-model override", () => {
  it("hydrates the server HTML without mismatch and adopts the override from /api/settings", async () => {
    // Server render: the override is present, as in production SSR.
    vi.stubEnv("COACH_DEFAULT_MODEL", "claude-opus-4-6");
    const serverHtml = renderToStaticMarkup(<SettingsPage />);
    // Browser hydration: a server-only env var is not in the client bundle.
    vi.unstubAllEnvs();

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = serverHtml;
    let root: ReturnType<typeof createRoot> | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(<SettingsPage />);
    });

    // The initial selection is identical on both sides: the server HTML (with
    // the override set) selects the shipped fallback constant, and hydrating
    // the browser (override absent) reports zero hydration errors.
    expect(serverHtml).toContain('value="anthropic:claude-sonnet-5-5"');
    expect(errorSpy).not.toHaveBeenCalled();

    // ...and the overridden server default is applied by the /api/settings
    // fetch that always settles after mount, not by divergent initial state.
    const select = container.querySelector<HTMLSelectElement>(
      "select[aria-label='Coach model']",
    );
    await waitFor(() => expect(select?.value).toBe("anthropic:claude-opus-4-6"));
    expect(select?.value).toBe("anthropic:claude-opus-4-6");

    await act(async () => { root?.unmount(); });
  });
});
