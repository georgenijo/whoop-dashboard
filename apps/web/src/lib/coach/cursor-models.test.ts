// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CursorModelCatalogError,
  listCursorModelsForKey,
} from "./cursor-models";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("COACH_CURSOR_TRANSPORT", "legacy");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllEnvs());

describe("listCursorModelsForKey", () => {
  it("returns a display-safe, deduplicated account catalog", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        items: [
          {
            id: "composer-2.5",
            displayName: "Composer 2.5",
            description: "Cursor's coding model",
            parameters: [
              {
                id: "effort",
                displayName: "Reasoning",
                values: [
                  { value: "medium", displayName: "Medium" },
                  { value: "high", displayName: "High" },
                ],
              },
            ],
            variants: [
              {
                params: [{ id: "effort", value: "medium" }],
                displayName: "Medium",
                isDefault: true,
              },
            ],
          },
          {
            id: "gpt-5.5-high",
            displayName: "GPT-5.5 High",
          },
          {
            id: "composer-2.5",
            displayName: "Duplicate",
          },
          {
            id: " ",
            displayName: "Malformed",
          },
          {
            id: "--help",
            displayName: "Unsafe",
          },
        ],
      }),
    );

    await expect(listCursorModelsForKey("key_personal")).resolves.toEqual([
      {
        id: "composer-2.5",
        display_name: "Composer 2.5",
        description: "Cursor's coding model",
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
      {
        id: "gpt-5.5-high",
        display_name: "GPT-5.5 High",
        description: null,
        parameters: [],
        variants: [],
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cursor.com/v1/models",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
          Authorization: "Bearer key_personal",
        },
      }),
    );
  });

  it("classifies rejected credentials without exposing the key", async () => {
    fetchMock.mockResolvedValue(new Response("unauthorized", { status: 401 }));

    await expect(listCursorModelsForKey("key_secret")).rejects.toMatchObject({
      name: "CursorModelCatalogError",
      reason: "invalid_key",
    } satisfies Partial<CursorModelCatalogError>);
  });

  it("classifies network and server failures as unavailable", async () => {
    fetchMock.mockRejectedValue(new Error("socket closed"));

    await expect(listCursorModelsForKey("key_secret")).rejects.toMatchObject({
      name: "CursorModelCatalogError",
      reason: "unavailable",
    } satisfies Partial<CursorModelCatalogError>);

    fetchMock.mockResolvedValue(
      new Response("upstream error", { status: 503 }),
    );
    await expect(listCursorModelsForKey("key_secret")).rejects.toMatchObject({
      reason: "unavailable",
    });
  });

  it("rejects malformed successful responses as unavailable", async () => {
    fetchMock.mockResolvedValue(Response.json({ models: [] }));

    await expect(listCursorModelsForKey("key_secret")).rejects.toMatchObject({
      reason: "unavailable",
    });
  });
});
