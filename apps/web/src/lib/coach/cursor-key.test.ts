// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getUserSettingsMock = vi.fn();
const listCursorModelsForKeyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  getUserSettings: (...args: unknown[]) => getUserSettingsMock(...args),
}));
vi.mock("./cursor-models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cursor-models")>();
  return {
    ...actual,
    listCursorModelsForKey: (...args: unknown[]) =>
      listCursorModelsForKeyMock(...args),
  };
});

import {
  MissingCursorKeyError,
  probeCursorKey,
  resolveCursorKey,
} from "./cursor-key";

const originalEnvKey = process.env.CURSOR_API_KEY;

beforeEach(() => {
  getUserSettingsMock.mockReset();
  listCursorModelsForKeyMock.mockReset();
  delete process.env.CURSOR_API_KEY;
});

afterEach(() => {
  if (originalEnvKey === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = originalEnvKey;
});

describe("resolveCursorKey", () => {
  it("prefers the user's decrypted key", () => {
    getUserSettingsMock.mockReturnValue({ cursor_key: "crsr_personal" });
    process.env.CURSOR_API_KEY = "crsr_shared";
    expect(resolveCursorKey(7)).toEqual({
      key: "crsr_personal",
      origin: "user",
    });
    expect(getUserSettingsMock).toHaveBeenCalledWith(7);
  });

  it("falls back to the shared environment key", () => {
    getUserSettingsMock.mockReturnValue({ cursor_key: null });
    process.env.CURSOR_API_KEY = "crsr_shared";
    expect(resolveCursorKey(7)).toEqual({
      key: "crsr_shared",
      origin: "env",
    });
  });

  it("throws when neither key exists", () => {
    getUserSettingsMock.mockReturnValue(null);
    expect(() => resolveCursorKey(7)).toThrow(MissingCursorKeyError);
  });
});

describe("probeCursorKey", () => {
  it("uses the model catalog with the candidate key", async () => {
    listCursorModelsForKeyMock.mockResolvedValue([
      {
        id: "composer-2.5",
        display_name: "Composer 2.5",
        description: null,
      },
    ]);
    await expect(probeCursorKey("crsr_candidate")).resolves.toBe("ok");
    expect(listCursorModelsForKeyMock).toHaveBeenCalledWith("crsr_candidate");
  });

  it("classifies a catalog authentication failure", async () => {
    const { CursorModelCatalogError } = await import("./cursor-models");
    listCursorModelsForKeyMock.mockRejectedValue(
      new CursorModelCatalogError("invalid_key", "rejected"),
    );
    await expect(probeCursorKey("crsr_bad")).resolves.toBe("invalid_key");
  });

  it("classifies catalog network failures as probe failures", async () => {
    const { CursorModelCatalogError } = await import("./cursor-models");
    listCursorModelsForKeyMock.mockRejectedValue(
      new CursorModelCatalogError("unavailable", "network"),
    );
    await expect(probeCursorKey("crsr_candidate")).resolves.toBe(
      "probe_failed",
    );
  });
});
