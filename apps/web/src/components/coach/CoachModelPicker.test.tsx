import {
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
        screen.getByRole("button", { name: "Coach model: GPT-5.5 High" }),
      ).toBeInTheDocument(),
    );
    expect(onSavingChange).toHaveBeenNthCalledWith(1, true);
    expect(onSavingChange).toHaveBeenLastCalledWith(false);
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

  it("shows models first and keeps reasoning in a model submenu", () => {
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
      screen.getByRole("radiogroup", { name: "Thinking effort" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Back to models" }),
    ).toBeVisible();
  });

  it("uses inverted submenu directions and restores focus when going back", () => {
    fetchMock.mockResolvedValue(catalogResponse());
    renderPicker();

    openPicker();
    const customize = screen.getByRole("button", {
      name: "Customize Claude Sonnet 4.6",
    });
    expect(customize.querySelector(".lucide-chevron-left")).not.toBeNull();

    fireEvent.click(customize);
    const back = screen.getByRole("button", { name: "Back to models" });
    expect(back.querySelector(".lucide-chevron-right")).not.toBeNull();

    fireEvent.click(back);
    expect(customize).toHaveFocus();

    fireEvent.click(customize);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(customize).toHaveFocus();
    expect(
      screen.queryByRole("region", {
        name: "Claude Sonnet 4.6 customization",
      }),
    ).not.toBeInTheDocument();
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
