import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CoachModelPicker from "./CoachModelPicker";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
  it("loads available Cursor models and persists a selection", async () => {
    fetchMock
      .mockResolvedValueOnce(catalogResponse())
      .mockResolvedValueOnce(
        Response.json({ model_pref: "cursor:gpt-5.5-high" }),
      );
    const { onSavingChange } = renderPicker();

    openPicker();
    const cursorOption = await screen.findByRole("button", {
      name: "Select GPT-5.5 High",
    });
    expect(
      screen.getByRole("region", { name: "Choose a model" }),
    ).toBeVisible();
    expect(screen.getByRole("group", { name: "Coach models" })).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Anthropic models" }),
    ).toBeVisible();
    expect(screen.getByRole("group", { name: "Cursor models" })).toBeVisible();
    expect(
      screen.queryByText("Deep reasoning for complex questions."),
    ).not.toBeInTheDocument();

    fireEvent.click(cursorOption);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_pref: "cursor:gpt-5.5-high" }),
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Coach model: GPT-5.5 High; effort medium",
        }),
      ).toBeInTheDocument(),
    );
    expect(onSavingChange).toHaveBeenNthCalledWith(1, true);
    expect(onSavingChange).toHaveBeenLastCalledWith(false);
  });

  it("filters the model catalog from the search field", async () => {
    fetchMock.mockResolvedValue(catalogResponse());
    renderPicker();

    openPicker();
    const search = screen.getByRole("searchbox", { name: "Search models" });
    fireEvent.change(search, { target: { value: "gpt" } });

    expect(
      await screen.findByRole("button", { name: "Select GPT-5.5 High" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Select Claude Sonnet 4.6" }),
    ).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "nothing here" } });
    expect(screen.getByRole("status")).toHaveTextContent(
      "No models match “nothing here”",
    );
  });

  it("restores the previous model and surfaces an inline save error", async () => {
    fetchMock
      .mockResolvedValueOnce(catalogResponse())
      .mockResolvedValueOnce(
        Response.json(
          { error: "Cursor model catalog is unavailable" },
          { status: 502 },
        ),
      );
    renderPicker();

    openPicker();
    fireEvent.click(
      await screen.findByRole("button", { name: "Select GPT-5.5 High" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cursor model catalog is unavailable",
    );
    expect(
      screen.getByRole("button", {
        name: "Coach model: Claude Sonnet 4.6; effort high",
      }),
    ).toBeInTheDocument();
  });

  it("keeps a saved dynamic Cursor model visible while its catalog loads", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderPicker({ initialModelPref: "cursor:composer-2.5-fast" });

    openPicker();

    expect(
      screen.getByRole("button", {
        name: "Select composer-2.5-fast",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", {
        name: "Coach model: composer-2.5-fast",
      }),
    ).toBeInTheDocument();
  });

  it("explains why only Claude is available when Cursor rejects the key", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ status: "invalid_key", models: [] }),
    );
    renderPicker();

    openPicker();

    expect(
      await screen.findByText("Cursor key needs attention"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The configured key was rejected, so only Claude is available.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage key" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("persists Anthropic thinking effort from the model menu", async () => {
    fetchMock
      .mockResolvedValueOnce(catalogResponse())
      .mockResolvedValueOnce(Response.json({ coach_effort: "max" }));
    const { onSavingChange } = renderPicker();

    openPicker();
    fireEvent.click(
      screen.getByRole("button", { name: "Customize Claude Sonnet 4.6" }),
    );
    expect(
      screen.getByRole("region", {
        name: "Claude Sonnet 4.6 customization",
      }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: /Max/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coach_effort: "max" }),
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Coach model: Claude Sonnet 4.6; effort max",
        }),
      ).toBeInTheDocument(),
    );
    expect(onSavingChange).toHaveBeenNthCalledWith(1, true);
    expect(onSavingChange).toHaveBeenLastCalledWith(false);
  });

  it("can turn Anthropic thinking off", async () => {
    fetchMock
      .mockResolvedValueOnce(catalogResponse())
      .mockResolvedValueOnce(Response.json({ coach_effort: "off" }));
    renderPicker();

    openPicker();
    fireEvent.click(
      screen.getByRole("button", { name: "Customize Claude Sonnet 4.6" }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /None/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coach_effort: "off" }),
      }),
    );
    expect(
      screen.getByRole("button", {
        name: "Coach model: Claude Sonnet 4.6; effort off",
      }),
    ).toBeInTheDocument();
  });

  it("persists the selected Cursor model's catalog-backed effort", async () => {
    fetchMock.mockResolvedValueOnce(catalogResponse()).mockResolvedValueOnce(
      Response.json({
        model_pref: "cursor:gpt-5.5-high",
        coach_effort: "high",
        cursor_model_params: {
          "gpt-5.5-high": [{ id: "effort", value: "high" }],
        },
      }),
    );
    renderPicker({ initialModelPref: "cursor:gpt-5.5-high" });

    openPicker();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Customize GPT-5.5 High",
      }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /High/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cursor_model_params: {
            model_id: "gpt-5.5-high",
            params: [{ id: "effort", value: "high" }],
          },
        }),
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Coach model: GPT-5.5 High; effort high",
        }),
      ).toBeInTheDocument(),
    );
  });

  it("renders boolean Cursor reasoning as an on/off switch", async () => {
    fetchMock
      .mockResolvedValueOnce(booleanReasoningCatalogResponse())
      .mockResolvedValueOnce(
        Response.json({
          cursor_model_params: {
            "claude-opus-5": [{ id: "thinking", value: "false" }],
          },
        }),
      );
    renderPicker({
      initialModelPref: "cursor:claude-opus-5",
      initialCursorModelParams: {
        "claude-opus-5": [{ id: "thinking", value: "true" }],
      },
    });

    const trigger = await screen.findByRole("button", {
      name: "Coach model: Opus 5; reasoning on",
    });
    expect(trigger).toHaveTextContent("Reasoning on");
    expect(trigger).not.toHaveTextContent(/true|false/i);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Customize Opus 5" }));
    const reasoning = screen.getByRole("switch", { name: "Reasoning" });
    expect(reasoning).toHaveAttribute("aria-checked", "true");
    fireEvent.click(reasoning);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cursor_model_params: {
            model_id: "claude-opus-5",
            params: [{ id: "thinking", value: "false" }],
          },
        }),
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Coach model: Opus 5; reasoning off",
        }),
      ).toHaveTextContent("Reasoning off"),
    );
  });

  it("shows models first and replaces them with compact reasoning controls", () => {
    fetchMock.mockResolvedValue(catalogResponse());
    renderPicker();

    openPicker();

    expect(
      screen.getByRole("region", { name: "Choose a model" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("radiogroup", { name: "Thinking effort" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Customize Claude Sonnet 4.6" }),
    );

    expect(
      screen.queryByRole("region", { name: "Choose a model" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", {
        name: "Claude Sonnet 4.6 customization",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("radiogroup", { name: "Thinking effort" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Back to models" }),
    ).toBeVisible();
  });

  it("uses conventional drill-in directions and restores focus when going back", () => {
    fetchMock.mockResolvedValue(catalogResponse());
    renderPicker();

    openPicker();
    const customize = screen.getByRole("button", {
      name: "Customize Claude Sonnet 4.6",
    });
    expect(customize.querySelector(".lucide-chevron-right")).not.toBeNull();

    fireEvent.click(customize);
    const back = screen.getByRole("button", { name: "Back to models" });
    expect(back.querySelector(".lucide-chevron-left")).not.toBeNull();
    expect(document.querySelectorAll(".coach-model-menu")).toHaveLength(1);
    expect(back).toHaveFocus();

    fireEvent.click(back);
    const restoredCustomize = screen.getByRole("button", {
      name: "Customize Claude Sonnet 4.6",
    });
    expect(restoredCustomize).toHaveFocus();

    fireEvent.click(restoredCustomize);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.getByRole("button", {
        name: "Customize Claude Sonnet 4.6",
      }),
    ).toHaveFocus();
    expect(
      screen.queryByRole("region", {
        name: "Claude Sonnet 4.6 customization",
      }),
    ).not.toBeInTheDocument();
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
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderPicker({ disabled: true });

    expect(
      screen.getByRole("button", {
        name: "Coach model: Claude Sonnet 4.6; effort high",
      }),
    ).toBeDisabled();
  });
});
