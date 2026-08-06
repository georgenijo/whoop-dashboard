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
        description: null,
      },
    ],
  });
}

describe("CoachModelPicker", () => {
  it("loads available Cursor models and persists a selection", async () => {
    const onSavingChange = vi.fn();
    fetchMock
      .mockResolvedValueOnce(catalogResponse())
      .mockResolvedValueOnce(
        Response.json({ model_pref: "cursor:gpt-5.5-high" }),
      );

    render(
      <CoachModelPicker
        initialModelPref="anthropic:claude-sonnet-4-6"
        disabled={false}
        onSavingChange={onSavingChange}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Coach model" });
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "Cursor — GPT-5.5 High" }),
      ).toBeInTheDocument(),
    );

    fireEvent.change(select, { target: { value: "cursor:gpt-5.5-high" } });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_pref: "cursor:gpt-5.5-high" }),
      }),
    );
    await waitFor(() => expect(select).toHaveValue("cursor:gpt-5.5-high"));
    expect(onSavingChange).toHaveBeenNthCalledWith(1, true);
    expect(onSavingChange).toHaveBeenLastCalledWith(false);
  });

  it("restores the previous model and surfaces an inline save error", async () => {
    const onSavingChange = vi.fn();
    fetchMock
      .mockResolvedValueOnce(catalogResponse())
      .mockResolvedValueOnce(
        Response.json(
          { error: "Cursor model catalog is unavailable" },
          { status: 502 },
        ),
      );

    render(
      <CoachModelPicker
        initialModelPref="anthropic:claude-sonnet-4-6"
        disabled={false}
        onSavingChange={onSavingChange}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Coach model" });
    await screen.findByRole("option", { name: "Cursor — GPT-5.5 High" });
    fireEvent.change(select, { target: { value: "cursor:gpt-5.5-high" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cursor model catalog is unavailable",
    );
    expect(select).toHaveValue("anthropic:claude-sonnet-4-6");
    expect(onSavingChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps a saved dynamic Cursor model visible while its catalog loads", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(
      <CoachModelPicker
        initialModelPref="cursor:composer-2.5-fast"
        disabled={false}
        onSavingChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("option", {
        name: "Cursor — composer-2.5-fast (saved)",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Coach model" })).toHaveValue(
      "cursor:composer-2.5-fast",
    );
  });

  it("cannot change models during an active Coach turn", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(
      <CoachModelPicker
        initialModelPref="anthropic:claude-sonnet-4-6"
        disabled
        onSavingChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Coach model" })).toBeDisabled();
  });
});
