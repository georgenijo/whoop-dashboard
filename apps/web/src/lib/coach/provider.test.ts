// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

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
      model: "composer-2.5",
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
    if (orig === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = orig;
  });

  it("is true only when CURSOR_API_KEY is set", () => {
    process.env.CURSOR_API_KEY = "crsr_test";
    expect(cursorProviderEnabled()).toBe(true);
    delete process.env.CURSOR_API_KEY;
    expect(cursorProviderEnabled()).toBe(false);
  });
});
