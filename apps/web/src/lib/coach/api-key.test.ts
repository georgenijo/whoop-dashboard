import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getUserSettingsMock = vi.fn();

vi.mock("@/lib/db", () => ({
  getUserSettings: (...args: unknown[]) => getUserSettingsMock(...args),
}));

import {
  MissingApiKeyError,
  resolveApiKeyForUser,
} from "./api-key";

describe("resolveApiKeyForUser", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.ANTHROPIC_API_KEY;
    getUserSettingsMock.mockReset();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalEnv;
  });

  it("returns BYOK key with origin=user when user_settings has a key", () => {
    getUserSettingsMock.mockReturnValue({ anthropic_key: "sk-ant-byok-XYZ" });
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-IGNORED";
    expect(resolveApiKeyForUser(1)).toEqual({
      key: "sk-ant-byok-XYZ",
      origin: "user",
    });
  });

  it("falls back to env key with origin=env when user_settings has no key", () => {
    getUserSettingsMock.mockReturnValue({ anthropic_key: null });
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-ABC";
    expect(resolveApiKeyForUser(1)).toEqual({
      key: "sk-ant-env-ABC",
      origin: "env",
    });
  });

  it("falls back to env key when user has no settings row at all", () => {
    getUserSettingsMock.mockReturnValue(null);
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-DEF";
    expect(resolveApiKeyForUser(1)).toEqual({
      key: "sk-ant-env-DEF",
      origin: "env",
    });
  });

  it("throws MissingApiKeyError when neither source has a key", () => {
    getUserSettingsMock.mockReturnValue(null);
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => resolveApiKeyForUser(1)).toThrow(MissingApiKeyError);
  });

  it("after BYOK clear (anthropic_key=null), env wins instead of throwing if env is set", () => {
    // Regression guard: a user who has a settings row with a non-key field
    // (e.g., model_pref) but no anthropic_key must still fall through to env.
    getUserSettingsMock.mockReturnValue({
      anthropic_key: null,
      model_pref: "claude-sonnet-4-6",
    });
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-GHI";
    expect(resolveApiKeyForUser(1).origin).toBe("env");
  });
});
