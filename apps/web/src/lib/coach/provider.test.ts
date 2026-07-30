// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getUserSettingsMock = vi.fn();
vi.mock("@/lib/db", () => ({
  getUserSettings: (...args: unknown[]) => getUserSettingsMock(...args),
}));

import {
  ANTHROPIC_PREF,
  CURSOR_PREF,
  cursorProviderEnabled,
  parseModelPref,
} from "./provider";

describe("parseModelPref", () => {
  it("defaults null/undefined to the Anthropic default", () => {
    expect(parseModelPref(null)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
    expect(parseModelPref(undefined)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
  });

  it("parses the known anthropic + cursor prefs", () => {
    expect(parseModelPref(ANTHROPIC_PREF).provider).toBe("anthropic");
    expect(parseModelPref(CURSOR_PREF)).toEqual({
      provider: "cursor",
      model: "composer-2.5-fast",
    });
  });

  it("upgrades the legacy Cursor preference to the fast variant", () => {
    expect(parseModelPref("cursor:composer-2.5")).toEqual({
      provider: "cursor",
      model: "composer-2.5-fast",
    });
  });

  it("falls back unknown/legacy values to Anthropic", () => {
    expect(parseModelPref("garbage:x").provider).toBe("anthropic");
    expect(parseModelPref("claude-sonnet-4-6").provider).toBe("anthropic");
  });
});

describe("cursorProviderEnabled", () => {
  const orig = process.env.CURSOR_API_KEY;
  afterEach(() => {
    getUserSettingsMock.mockReset();
    if (orig === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = orig;
  });

  it("is true when a personal key exists", () => {
    delete process.env.CURSOR_API_KEY;
    getUserSettingsMock.mockReturnValue({ cursor_key: "crsr_personal" });
    expect(cursorProviderEnabled(1)).toBe(true);
    expect(getUserSettingsMock).toHaveBeenCalledWith(1);
  });

  it("falls back to CURSOR_API_KEY", () => {
    getUserSettingsMock.mockReturnValue({ cursor_key: null });
    process.env.CURSOR_API_KEY = "crsr_test";
    expect(cursorProviderEnabled(1)).toBe(true);
    delete process.env.CURSOR_API_KEY;
    expect(cursorProviderEnabled(1)).toBe(false);
  });
});
