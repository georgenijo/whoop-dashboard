// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sdk = vi.hoisted(() => {
  class CursorSdkError extends Error {
    readonly status?: number;
    readonly code?: string;

    constructor(
      message: string,
      options: { status?: number; code?: string } = {},
    ) {
      super(message);
      this.status = options.status;
      this.code = options.code;
    }
  }
  class AuthenticationError extends CursorSdkError {}
  return {
    list: vi.fn(),
    CursorSdkError,
    AuthenticationError,
  };
});

vi.mock("@cursor/sdk", () => ({
  Cursor: { models: { list: sdk.list } },
  CursorSdkError: sdk.CursorSdkError,
  AuthenticationError: sdk.AuthenticationError,
}));

import {
  CursorModelCatalogError,
  listCursorModelsForKey,
} from "./cursor-models";

beforeEach(() => {
  sdk.list.mockReset();
});

describe("listCursorModelsForKey", () => {
  it("returns a display-safe, deduplicated account catalog", async () => {
    sdk.list.mockResolvedValue([
      {
        id: "composer-2.5",
        displayName: "Composer 2.5",
        description: "Cursor's coding model",
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
    ]);

    await expect(listCursorModelsForKey("key_personal")).resolves.toEqual([
      {
        id: "composer-2.5",
        display_name: "Composer 2.5",
        description: "Cursor's coding model",
      },
      {
        id: "gpt-5.5-high",
        display_name: "GPT-5.5 High",
        description: null,
      },
    ]);
    expect(sdk.list).toHaveBeenCalledWith({ apiKey: "key_personal" });
  });

  it("classifies rejected credentials without exposing the key", async () => {
    sdk.list.mockRejectedValue(
      new sdk.AuthenticationError("unauthorized", { status: 401 }),
    );

    await expect(listCursorModelsForKey("key_secret")).rejects.toMatchObject({
      name: "CursorModelCatalogError",
      reason: "invalid_key",
    } satisfies Partial<CursorModelCatalogError>);
  });

  it("classifies network and server failures as unavailable", async () => {
    sdk.list.mockRejectedValue(new Error("socket closed"));

    await expect(listCursorModelsForKey("key_secret")).rejects.toMatchObject({
      name: "CursorModelCatalogError",
      reason: "unavailable",
    } satisfies Partial<CursorModelCatalogError>);
  });
});
