// @vitest-environment jsdom
// Issue #587 hydration regression: the Settings page's initial Coach-model
// state must be identical on the server and in the browser. Unlike
// COACH_DEFAULT_MODEL (a server-only env var), it must not take part in the
// initial render — otherwise the browser's first render diverges from the
// server's HTML and hydration repairs it, logging a recoverable error.
//
// Deliberately constructed to detect the original defect:
// - the page module is loaded twice, once under the server-only override (SSR)
//   and once without it (browser), via vi.resetModules + dynamic import, so
//   module-level initialisation is seen in both environments;
// - hydrateRoot runs against the server markup (not a fresh client render) and
//   captures recoverable hydration errors via onRecoverableError as well as
//   console.error.
import { act, cleanup, waitFor } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    // Server: the page module is evaluated with the override present, as in
    // production SSR — every module-level initialisation sees the override.
    vi.resetModules();
    vi.stubEnv("COACH_DEFAULT_MODEL", "claude-opus-4-6");
    const { default: ServerPage } = await import("./page");
    const serverHtml = renderToStaticMarkup(<ServerPage />);

    // The pre-settings-load placeholder is identical on both sides and shows
    // no model at all, so a wrong interim selection can neither display nor be
    // saved.
    expect(serverHtml).not.toContain("anthropic:claude");
    expect(serverHtml).toContain("Loading your saved model…");

    // Browser: a fresh evaluation of the page module without the env var —
    // exactly what the client bundle does.
    vi.resetModules();
    vi.unstubAllEnvs();
    const { default: ClientPage } = await import("./page");

    const recoverable: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = serverHtml;
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, <ClientPage />, {
        onRecoverableError: (error) => recoverable.push(error),
      });
    });
    // Hydrating (not re-rendering) the server markup with the client module
    // must produce no recoverable hydration errors and no console errors.
    expect(recoverable).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();

    const select = container.querySelector<HTMLSelectElement>(
      "select[aria-label='Coach model']",
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/settings");
    // The overridden server default is applied by the /api/settings fetch,
    // never by divergent initial state.
    await waitFor(() => expect(select?.value).toBe("anthropic:claude-opus-4-6"));
    await waitFor(() => expect(select?.disabled).toBe(false));

    await act(async () => { root?.unmount(); });
  });
});
