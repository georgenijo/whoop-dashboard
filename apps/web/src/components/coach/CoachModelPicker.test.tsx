import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CoachModelPicker from "./CoachModelPicker";
import SettingsPage from "@/app/(dashboard)/settings/page";

const fetchMock = vi.fn();

const cursorCatalogMock = vi.fn();
const anthropicCatalogMock = vi.fn();
const settingsMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  cursorCatalogMock.mockImplementation(catalogResponse);
  anthropicCatalogMock.mockImplementation(anthropicResponse);
  settingsMock.mockImplementation((_url, init) => {
    const body = JSON.parse(init.body);
    return Response.json(body.cursor_model_params ? {
      cursor_model_params: { [body.cursor_model_params.model_id]: body.cursor_model_params.params },
    } : body);
  });
  fetchMock.mockImplementation((url, init) => {
    if (url === "/api/me/cursor-models") return cursorCatalogMock(url, init);
    if (url === "/api/me/anthropic-models") return anthropicCatalogMock(url, init);
    if (url === "/api/settings") return settingsMock(url, init);
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function anthropicResponse() {
  return Response.json({
    status: "ready",
    models: [
      { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6", thinking: "adaptive", efforts: ["off", "low", "medium", "high"], max_tokens: 64000 },
      { id: "claude-opus-live", display_name: "Claude Opus Live", thinking: "adaptive", efforts: ["off", "high", "xhigh", "max"], max_tokens: 64000 },
      { id: "claude-legacy", display_name: "Claude Legacy", thinking: "none", efforts: ["off"], max_tokens: 4096 },
      { id: "claude-thinking", display_name: "Claude Thinking", thinking: "enabled", efforts: ["off", "medium", "high"], max_tokens: 64000 },
    ],
  });
}

function catalogResponse() {
  return Response.json({
    status: "ready",
    models: [
      {
        id: "gpt-5.5-high",
        display_name: "GPT-5.5 High",
        description: "Deep reasoning for complex questions.",
        parameters: [
          {
            id: "effort",
            display_name: "Reasoning",
            values: [
              { value: "medium", display_name: "Medium" },
              { value: "high", display_name: "High" },
            ],
          },
        ],
        variants: [
          {
            params: [{ id: "effort", value: "medium" }],
            display_name: "Medium",
            description: null,
            is_default: true,
          },
        ],
      },
    ],
  });
}

function booleanReasoningCatalogResponse() {
  return Response.json({
    status: "ready",
    models: [
      {
        id: "claude-opus-5",
        display_name: "Opus 5",
        description: null,
        parameters: [
          {
            id: "thinking",
            display_name: "Reasoning",
            values: [
              { value: "true", display_name: null },
              { value: "false", display_name: null },
            ],
          },
        ],
        variants: [
          {
            params: [{ id: "thinking", value: "true" }],
            display_name: "Reasoning",
            description: null,
            is_default: true,
          },
        ],
      },
    ],
  });
}

function renderPicker(
  overrides: Partial<Parameters<typeof CoachModelPicker>[0]> = {},
) {
  const onSavingChange = vi.fn();
  render(
    <CoachModelPicker
      initialModelPref="anthropic:claude-sonnet-4-6"
      initialCoachEffort="high"
      disabled={false}
      onSavingChange={onSavingChange}
      {...overrides}
    />,
  );
  return { onSavingChange };
}

function openPicker() {
  fireEvent.click(
    screen.getByRole("button", {
      name: /Coach model:/,
    }),
  );
}

describe("CoachModelPicker", () => {
  it("selects a live Anthropic model and persists its dynamic id", async () => {
    const { onSavingChange } = renderPicker();
    openPicker();
    fireEvent.click(await screen.findByRole("button", { name: "Select Claude Opus Live" }));
    await waitFor(() => expect(settingsMock).toHaveBeenCalledWith("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_pref: "anthropic:claude-opus-live" }),
    }));
    expect(screen.getByRole("button", { name: "Coach model: Claude Opus Live; effort high" })).toBeInTheDocument();
    expect(onSavingChange).toHaveBeenNthCalledWith(1, true);
    await waitFor(() => expect(onSavingChange).toHaveBeenLastCalledWith(false));
  });

  it("selects Cursor independently of an Anthropic network error", async () => {
    anthropicCatalogMock.mockRejectedValue(new Error("offline"));
    renderPicker();
    openPicker();
    fireEvent.click(await screen.findByRole("button", { name: "Select GPT-5.5 High" }));
    await waitFor(() => expect(screen.getByRole("button", {
      name: "Coach model: GPT-5.5 High; effort medium",
    })).toBeInTheDocument());
  });

  it("keeps Anthropic usable while Cursor is still loading", async () => {
    cursorCatalogMock.mockReturnValue(new Promise(() => {}));
    renderPicker();
    openPicker();
    expect(await screen.findByRole("button", { name: "Select Claude Opus Live" })).toBeEnabled();
    expect(screen.getByText("Checking Cursor models…")).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Settings" })).toHaveLength(2);
  });

  it("keeps Cursor usable while Anthropic is still loading", async () => {
    anthropicCatalogMock.mockReturnValue(new Promise(() => {}));
    renderPicker();
    openPicker();
    expect(await screen.findByRole("button", { name: "Select GPT-5.5 High" })).toBeEnabled();
    expect(screen.getByText("Checking Anthropic models…")).toBeVisible();
    expect(screen.getByRole("button", { name: "Select claude-sonnet-4-6" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Customize claude-sonnet/ })).not.toBeInTheDocument();
  });

  it.each(["not_configured", "invalid_key", "unavailable"])("gates Anthropic when its catalog is %s", async (status) => {
    anthropicCatalogMock.mockImplementation(() => Response.json({ status, models: [] }));
    renderPicker({ initialModelPref: "anthropic:claude-saved-custom" });
    openPicker();
    expect(await screen.findByRole("button", { name: "Select GPT-5.5 High" })).toBeEnabled();
    const saved = screen.getByRole("button", { name: "Select claude-saved-custom" });
    expect(saved).toBeDisabled();
    expect(saved).toHaveAttribute("aria-pressed", "true");
    expect(saved).toHaveTextContent("unavailable");
    expect(screen.queryByRole("button", { name: /Customize claude-saved/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select Claude Sonnet 4.6" })).not.toBeInTheDocument();
    fireEvent.click(saved);
    expect(settingsMock).not.toHaveBeenCalled();
  });

  it("shows each provider's error and Settings link in its own section", async () => {
    anthropicCatalogMock.mockImplementation(() => Response.json({ status: "not_configured", models: [] }));
    cursorCatalogMock.mockImplementation(() => Response.json({ status: "invalid_key", models: [] }));
    renderPicker();
    openPicker();
    expect(await screen.findByText("Cursor rejected the configured API key. Update it in Settings.")).toBeVisible();
    expect(screen.getByText("Add an Anthropic API key in Settings to enable models.")).toBeVisible();
    const links = screen.getAllByRole("link", { name: "Settings" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/settings#coach-byok", "/settings#coach-cursor-byok"]);
    expect(screen.queryByText(/only Claude|Claude is available/)).not.toBeInTheDocument();
  });

  it("keeps a saved Cursor model visible but gated when it is missing", async () => {
    renderPicker({ initialModelPref: "cursor:missing-model" });
    openPicker();
    await screen.findByRole("button", { name: "Select GPT-5.5 High" });
    expect(screen.getByRole("button", { name: "Select missing-model" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Coach model: missing-model" })).toBeInTheDocument();
  });

  it("collapses providers independently and keeps the selected summary visible", async () => {
    renderPicker();
    openPicker();
    await screen.findByRole("button", { name: "Select Claude Sonnet 4.6" });
    const anthropic = screen.getByRole("button", { name: /Anthropic; selected model: Claude Sonnet/ });
    const cursor = screen.getByRole("button", { name: "Cursor" });
    fireEvent.click(anthropic);
    expect(anthropic).toHaveAttribute("aria-expanded", "false");
    expect(anthropic).toHaveTextContent("Selected: Claude Sonnet 4.6");
    expect(document.getElementById(anthropic.getAttribute("aria-controls")!)).not.toBeVisible();
    expect(cursor).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Select GPT-5.5 High" })).toBeVisible();
    fireEvent.click(cursor);
    fireEvent.click(anthropic);
    expect(anthropic).toHaveAttribute("aria-expanded", "true");
    expect(cursor).toHaveAttribute("aria-expanded", "false");
  });

  it("searches collapsed groups and restores collapse state when cleared", async () => {
    renderPicker();
    openPicker();
    await screen.findByRole("button", { name: "Select GPT-5.5 High" });
    const anthropic = screen.getByRole("button", { name: /Anthropic; selected model:/ });
    const cursor = screen.getByRole("button", { name: "Cursor" });
    fireEvent.click(anthropic);
    fireEvent.click(cursor);
    const search = screen.getByRole("searchbox", { name: "Search models" });
    fireEvent.change(search, { target: { value: "high" } });
    expect(screen.getByRole("button", { name: "Select GPT-5.5 High" })).toBeVisible();
    expect(cursor).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: "Select Claude Sonnet 4.6" })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "Claude" } });
    expect(screen.getByRole("button", { name: "Select Claude Sonnet 4.6" })).toBeVisible();
    fireEvent.change(search, { target: { value: "" } });
    expect(anthropic).toHaveAttribute("aria-expanded", "false");
    expect(cursor).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Select GPT-5.5 High" })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "nothing here" } });
    expect(screen.getByText("No models match “nothing here”")).toBeVisible();
  });

  it("filters effort metadata and displays effective effort for an unsupported preference", async () => {
    renderPicker({ initialCoachEffort: "max" });
    openPicker();
    fireEvent.click(await screen.findByRole("button", { name: "Customize Claude Sonnet 4.6" }));
    expect(screen.getByRole("button", { name: "Coach model: Claude Sonnet 4.6; effort high" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Max/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Extra high/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /High/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: /None/ }));
    await waitFor(() => expect(settingsMock).toHaveBeenCalledWith("/api/settings", expect.objectContaining({ body: JSON.stringify({ coach_effort: "off" }) })));
  });

  it("supports catalog-backed Extra high effort", async () => {
    renderPicker({ initialModelPref: "anthropic:claude-opus-live" });
    openPicker();
    fireEvent.click(await screen.findByRole("button", { name: "Customize Claude Opus Live" }));
    fireEvent.click(screen.getByRole("radio", { name: /Extra high/ }));
    await waitFor(() => expect(settingsMock).toHaveBeenCalledWith("/api/settings", expect.objectContaining({ body: JSON.stringify({ coach_effort: "xhigh" }) })));
    expect(screen.getByRole("button", { name: "Coach model: Claude Opus Live; effort xhigh" })).toHaveTextContent("Extra high");
  });

  it("hides None for Sonnet 5.5 and displays a supported effort for saved off", async () => {
    anthropicCatalogMock.mockImplementation(() => Response.json({ status: "ready", models: [{
      id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5", thinking: "adaptive",
      efforts: ["low", "medium", "high", "xhigh", "max"], max_tokens: 128000,
    }] }));
    renderPicker({ initialModelPref: "anthropic:claude-sonnet-5-5", initialCoachEffort: "off" });
    openPicker();
    fireEvent.click(await screen.findByRole("button", { name: "Customize Claude Sonnet 5.5" }));
    expect(screen.queryByRole("radio", { name: /None/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^High/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Coach model: Claude Sonnet 5.5; effort high" })).toBeInTheDocument();
  });

  it("hides reasoning customization for models without thinking", async () => {
    renderPicker({ initialModelPref: "anthropic:claude-legacy" });
    openPicker();
    expect(await screen.findByRole("button", { name: "Select Claude Legacy" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Customize Claude Legacy" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Coach model: Claude Legacy; effort off" })).toHaveTextContent("None");
  });

  it("uses supported legacy thinking profiles", async () => {
    renderPicker({ initialModelPref: "anthropic:claude-thinking" });
    openPicker();
    fireEvent.click(await screen.findByRole("button", { name: "Customize Claude Thinking" }));
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.queryByRole("radio", { name: /Low/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Medium/ }));
    await waitFor(() => expect(settingsMock).toHaveBeenCalledWith("/api/settings", expect.objectContaining({ body: JSON.stringify({ coach_effort: "medium" }) })));
  });

  it("refreshes both catalogs on reopen after an external key change", async () => {
    renderPicker();
    openPicker();
    await screen.findByRole("button", { name: "Customize Claude Sonnet 4.6" });
    const requestsBefore = anthropicCatalogMock.mock.calls.length;
    const cursorRequestsBefore = cursorCatalogMock.mock.calls.length;
    fireEvent.keyDown(document, { key: "Escape" });
    anthropicCatalogMock.mockImplementation(() => Response.json({ status: "not_configured", models: [] }));
    openPicker();
    await screen.findByText("Add an Anthropic API key in Settings to enable models.");
    expect(anthropicCatalogMock.mock.calls.length).toBe(requestsBefore + 1);
    expect(cursorCatalogMock.mock.calls.length).toBe(cursorRequestsBefore + 1);
    expect(screen.getByRole("button", { name: "Select claude-sonnet-4-6" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Customize Claude Sonnet 4.6" })).not.toBeInTheDocument();
  });

  it("rolls back selection and reports save failures", async () => {
    settingsMock.mockImplementation(() => Response.json({ error: "Catalog changed; try again" }, { status: 502 }));
    renderPicker();
    openPicker();
    fireEvent.click(await screen.findByRole("button", { name: "Select Claude Opus Live" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Catalog changed; try again");
    expect(screen.getByRole("button", { name: "Coach model: Claude Sonnet 4.6; effort high" })).toBeInTheDocument();
  });

  it("persists Cursor effort independently", async () => {
    renderPicker({ initialModelPref: "cursor:gpt-5.5-high" });
    openPicker();
    fireEvent.click(await screen.findByRole("button", { name: "Customize GPT-5.5 High" }));
    fireEvent.click(screen.getByRole("radio", { name: /High/ }));
    await waitFor(() => expect(settingsMock).toHaveBeenCalledWith("/api/settings", expect.objectContaining({ body: JSON.stringify({ cursor_model_params: { model_id: "gpt-5.5-high", params: [{ id: "effort", value: "high" }] } }) })));
    expect(screen.getByRole("button", { name: "Coach model: GPT-5.5 High; effort high" })).toBeInTheDocument();
  });

  it("renders boolean Cursor reasoning as a switch", async () => {
    cursorCatalogMock.mockImplementation(booleanReasoningCatalogResponse);
    renderPicker({ initialModelPref: "cursor:claude-opus-5" });
    openPicker();
    fireEvent.click(await screen.findByRole("button", { name: "Customize Opus 5" }));
    const reasoning = screen.getByRole("switch", { name: "Reasoning" });
    expect(reasoning).toHaveAttribute("aria-checked", "true");
    fireEvent.click(reasoning);
    await waitFor(() => expect(settingsMock).toHaveBeenCalledWith("/api/settings", expect.objectContaining({ body: JSON.stringify({ cursor_model_params: { model_id: "claude-opus-5", params: [{ id: "thinking", value: "false" }] } }) })));
    await waitFor(() => {
      const trigger = screen.getByRole("button", { name: "Coach model: Opus 5; reasoning off" });
      expect(trigger).toHaveTextContent("Reasoning off");
      expect(trigger).toBeEnabled();
    });
  });

  it("restores keyboard focus after customization and Escape", async () => {
    renderPicker();
    openPicker();
    const customize = await screen.findByRole("button", { name: "Customize Claude Sonnet 4.6" });
    expect(customize.querySelector(".lucide-chevron-right")).not.toBeNull();
    fireEvent.click(customize);
    const back = screen.getByRole("button", { name: "Back to models" });
    expect(back.querySelector(".lucide-chevron-left")).not.toBeNull();
    expect(back).toHaveFocus();
    fireEvent.click(back);
    expect(screen.getByRole("button", { name: "Customize Claude Sonnet 4.6" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Customize Claude Sonnet 4.6" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Customize Claude Sonnet 4.6" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: /Coach model:/ })).toHaveFocus();
    expect(screen.queryByRole("region", { name: "Choose a model" })).not.toBeInTheDocument();
  });

  it("keeps mobile panels inside the visual viewport as its height changes", () => {
    const viewportState = { height: 390 };
    const viewportListeners = new Map<
      string,
      EventListenerOrEventListenerObject
    >();
    const visualViewport = {
      get height() {
        return viewportState.height;
      },
      width: 844,
      offsetTop: 0,
      offsetLeft: 0,
      scale: 1,
      pageTop: 0,
      pageLeft: 0,
      onresize: null,
      onscroll: null,
      addEventListener: vi.fn(
        (type: string, listener: EventListenerOrEventListenerObject) => {
          viewportListeners.set(type, listener);
        },
      ),
      removeEventListener: vi.fn((type: string) => {
        viewportListeners.delete(type);
      }),
      dispatchEvent: vi.fn(),
    } as unknown as VisualViewport;
    vi.stubGlobal("visualViewport", visualViewport);
    vi.stubGlobal("innerHeight", 390);
    vi.stubGlobal("innerWidth", 844);
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderPicker();

    const trigger = screen.getByRole("button", { name: /Coach model:/ });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      top: 300,
      right: 820,
      bottom: 338,
      left: 620,
      width: 200,
      height: 38,
      x: 620,
      y: 300,
      toJSON: () => ({}),
    });

    fireEvent.click(trigger);
    const control = trigger.closest<HTMLElement>(".coach-model-control");
    expect(control).not.toBeNull();
    expect(
      control?.style.getPropertyValue("--coach-model-mobile-max-height"),
    ).toBe("278px");
    expect(
      control?.style.getPropertyValue("--coach-model-mobile-max-width"),
    ).toBe("812px");
    expect(control?.style.getPropertyValue("--coach-model-mobile-right")).toBe(
      "24px",
    );
    expect(control?.style.getPropertyValue("--coach-model-mobile-bottom")).toBe(
      "100px",
    );

    viewportState.height = 240;
    const resizeListener = viewportListeners.get("resize");
    act(() => {
      const event = new Event("resize");
      if (typeof resizeListener === "function") resizeListener(event);
      else resizeListener?.handleEvent(event);
    });

    expect(
      control?.style.getPropertyValue("--coach-model-mobile-max-height"),
    ).toBe("216px");
    expect(control?.style.getPropertyValue("--coach-model-mobile-bottom")).toBe(
      "162px",
    );
  });

  it("cannot change models during an active Coach turn", () => {
    renderPicker({ disabled: true });
    expect(screen.getByRole("button", { name: /Coach model:/ })).toBeDisabled();
  });
});

describe("Settings model catalog integration", () => {
  const anthropicKeyMock = vi.fn();
  const cursorKeyMock = vi.fn();

  beforeEach(() => {
    anthropicKeyMock.mockReset().mockImplementation(() => Response.json({
      present: false, masked: null, fallback_available: false, source: "none",
    }));
    cursorKeyMock.mockReset().mockImplementation(() => Response.json({
      present: true, masked: "cursor-…1234", fallback_available: false,
    }));
    settingsMock.mockImplementation((_url, init) => init?.method === "POST"
      ? Response.json(JSON.parse(init.body))
      : Response.json({ system_prompt: "", model_pref: "anthropic:claude-opus-live", anthropic_available: false, cursor_available: true }));
    fetchMock.mockImplementation(async (url, init) => {
      if (url === "/api/me/cursor-models") return cursorCatalogMock(url, init);
      if (url === "/api/me/anthropic-models") return anthropicCatalogMock(url, init);
      if (url === "/api/settings") return settingsMock(url, init);
      if (url === "/api/me/anthropic-key") return anthropicKeyMock(url, init);
      if (url === "/api/me/cursor-key") return cursorKeyMock(url, init);
      if (url === "/api/connectors/whoop") return Response.json({ status: "disconnected", provider: "whoop" });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  it("groups the live models by provider", async () => {
    render(<SettingsPage />);
    const select = screen.getByRole("combobox", { name: "Coach model" });
    expect(await within(select).findByRole("option", { name: "Claude Opus Live" })).toBeEnabled();
    expect(within(select).getByRole("group", { name: "Anthropic" })).toBeInTheDocument();
    expect(within(select).getByRole("group", { name: "Cursor" })).toBeInTheDocument();
    expect(select).toHaveValue("anthropic:claude-opus-live");
    fireEvent.change(select, { target: { value: "anthropic:claude-thinking" } });
    await waitFor(() => expect(settingsMock).toHaveBeenCalledWith("/api/settings", expect.objectContaining({ body: JSON.stringify({ model_pref: "anthropic:claude-thinking" }) })));
  });

  it("keeps unavailable saved models visible and other providers usable", async () => {
    anthropicCatalogMock.mockImplementation(() => Response.json({ status: "invalid_key", models: [] }));
    render(<SettingsPage />);
    expect(await screen.findByRole("option", { name: "claude-opus-live (saved, unavailable)" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Coach model" })).toHaveValue("anthropic:claude-opus-live");
    expect(await screen.findByRole("option", { name: "GPT-5.5 High" })).toBeEnabled();
    expect(screen.getByText("Anthropic rejected the current key. Update it below to load models.")).toBeVisible();
  });

  it.each([
    { source: "user", present: true, fallback_available: true, label: "Personal key" },
    { source: "env", present: false, fallback_available: true, label: "Shared key" },
    { source: "none", present: false, fallback_available: false, label: "Not configured" },
  ])("reflects Anthropic key source $source", async ({ source, present, fallback_available, label }) => {
    anthropicKeyMock.mockImplementation(() => Response.json({ present, masked: present ? "sk-ant-…1234" : null, fallback_available, source }));
    render(<SettingsPage />);
    const disclosure = await screen.findByRole("button", { name: new RegExp(`Anthropic access.*${label}`) });
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(disclosure.getAttribute("aria-controls")!)).not.toBeVisible();
    expect(screen.getByRole("button", { name: /Cursor access/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("refreshes Anthropic models after saving a personal key", async () => {
    anthropicCatalogMock.mockImplementation(() => Response.json({ status: "not_configured", models: [] }));
    render(<SettingsPage />);
    await screen.findByText("Add an Anthropic key below to enable its model catalog.");
    const requestsBefore = anthropicCatalogMock.mock.calls.length;
    anthropicCatalogMock.mockImplementation(anthropicResponse);
    anthropicKeyMock.mockImplementation(() => Response.json({ ok: true, present: true, masked: "sk-ant-…1234", fallback_available: false, source: "user" }));
    fireEvent.change(screen.getByLabelText("Personal Anthropic API key"), { target: { value: "sk-ant-valid-personal-key" } });
    fireEvent.click(within(document.getElementById("anthropic-access-settings")!).getByRole("button", { name: "Use this key" }));
    expect(await screen.findByRole("option", { name: "Claude Opus Live" })).toBeEnabled();
    expect(anthropicCatalogMock.mock.calls.length).toBe(requestsBefore + 1);
    expect(screen.getByRole("button", { name: /Anthropic access.*Personal key/ })).toBeVisible();
  });

  it("refreshes Anthropic models after removal and shows no shared key when absent", async () => {
    anthropicKeyMock.mockImplementation(() => Response.json({ present: true, masked: "sk-ant-…1234", fallback_available: false, source: "user" }));
    render(<SettingsPage />);
    await screen.findByRole("option", { name: "Claude Opus Live" });
    await screen.findByRole("button", { name: /Anthropic access.*Personal key/ });
    const requestsBefore = anthropicCatalogMock.mock.calls.length;
    anthropicCatalogMock.mockImplementation(() => Response.json({ status: "not_configured", models: [] }));
    anthropicKeyMock.mockImplementation(() => Response.json({ ok: true, present: false, masked: null, fallback_available: false, source: "none" }));
    fireEvent.click(within(document.getElementById("anthropic-access-settings")!).getByRole("button", { name: "Remove key" }));
    expect(await screen.findByRole("button", { name: /Anthropic access.*Not configured/ })).toBeVisible();
    await waitFor(() => expect(anthropicCatalogMock.mock.calls.length).toBe(requestsBefore + 1));
    expect(await screen.findByRole("option", { name: "claude-opus-live (saved, unavailable)" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Coach model" })).toHaveValue("anthropic:claude-opus-live");
    expect(vi.mocked(confirm)).toHaveBeenCalledWith(expect.stringContaining("will be unavailable"));
  });

  it("ignores an older Anthropic catalog after a key save refresh", async () => {
    let finishOldCatalog!: (response: Response) => void;
    anthropicCatalogMock.mockReturnValueOnce(new Promise<Response>((resolve) => {
      finishOldCatalog = resolve;
    }));
    render(<SettingsPage />);
    await waitFor(() => expect(anthropicCatalogMock).toHaveBeenCalledTimes(1));
    anthropicKeyMock.mockImplementation(() => Response.json({
      ok: true, present: true, masked: "sk-ant-…1234", fallback_available: false, source: "user",
    }));
    fireEvent.change(screen.getByLabelText("Personal Anthropic API key"), {
      target: { value: "sk-ant-valid-personal-key" },
    });
    fireEvent.click(within(document.getElementById("anthropic-access-settings")!).getByRole("button", { name: "Use this key" }));
    expect(await screen.findByRole("option", { name: "Claude Opus Live" })).toBeEnabled();
    await act(async () => finishOldCatalog(Response.json({ status: "not_configured", models: [] })));
    expect(screen.getByRole("option", { name: "Claude Opus Live" })).toBeEnabled();
  });

  it("preserves an Anthropic selection when a Cursor key is removed", async () => {
    render(<SettingsPage />);
    await screen.findByRole("button", { name: /Cursor access.*Personal key/ });
    cursorKeyMock.mockImplementation(() => Response.json({ present: false, masked: null, fallback_available: false, model_pref: "anthropic:claude-opus-live" }));
    fireEvent.click(within(document.getElementById("cursor-access-settings")!).getByRole("button", { name: "Remove key" }));
    await screen.findByRole("button", { name: /Cursor access.*Not configured/ });
    expect(screen.getByRole("combobox", { name: "Coach model" })).toHaveValue("anthropic:claude-opus-live");
  });
});
