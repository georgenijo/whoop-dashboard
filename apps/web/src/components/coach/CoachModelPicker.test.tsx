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
    const cursorOption = await screen.findByRole("option", {
      name: /GPT-5\.5 High/,
    });
    expect(screen.getByRole("listbox", { name: "Coach models" })).toBeVisible();
    expect(cursorOption).toHaveTextContent("Deep reasoning for complex questions.");

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
      await screen.findByRole("option", { name: /GPT-5\.5 High/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cursor model catalog is unavailable",
    );
    expect(
      screen.getByRole("button", { name: "Coach model: Claude Sonnet 4.6" }),
    ).toBeInTheDocument();
  });

  it("keeps a saved dynamic Cursor model visible while its catalog loads", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderPicker({ initialModelPref: "cursor:composer-2.5-fast" });

    openPicker();

    expect(
      screen.getByRole("option", {
        name: /composer-2\.5-fast/,
      }),
    ).toBeInTheDocument();
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

  it("cannot change models during an active Coach turn", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderPicker({ disabled: true });

    expect(
      screen.getByRole("button", {
        name: "Coach model: Claude Sonnet 4.6",
      }),
    ).toBeDisabled();
  });
});
