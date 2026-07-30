// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getUserSettingsMock = vi.fn();
const execFileMock = vi.fn();

vi.mock("@/lib/db", () => ({
  getUserSettings: (...args: unknown[]) => getUserSettingsMock(...args),
}));
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

import {
  MissingCursorKeyError,
  probeCursorKey,
  resolveCursorKey,
} from "./cursor-key";

const originalEnvKey = process.env.CURSOR_API_KEY;

beforeEach(() => {
  getUserSettingsMock.mockReset();
  execFileMock.mockReset();
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
  it("uses cursor-agent models with the candidate key", async () => {
    execFileMock.mockImplementation(
      (
        _bin: string,
        _args: string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => callback(null, "composer-2.5-fast", ""),
    );
    await expect(probeCursorKey("crsr_candidate")).resolves.toBe("ok");
    expect(execFileMock).toHaveBeenCalledWith(
      "cursor-agent",
      ["models"],
      expect.objectContaining({
        env: expect.objectContaining({ CURSOR_API_KEY: "crsr_candidate" }),
        timeout: 15_000,
      }),
      expect.any(Function),
    );
  });

  it("classifies an invalid-key diagnostic", async () => {
    execFileMock.mockImplementation(
      (
        _bin: string,
        _args: string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) =>
        callback(
          new Error("exit 1"),
          "",
          "Warning: The provided API key is invalid.",
        ),
    );
    await expect(probeCursorKey("crsr_bad")).resolves.toBe("invalid_key");
  });

  it("classifies missing binaries and timeouts as probe failures", async () => {
    execFileMock.mockImplementation(
      (
        _bin: string,
        _args: string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => callback(new Error("spawn ENOENT"), "", ""),
    );
    await expect(probeCursorKey("crsr_candidate")).resolves.toBe(
      "probe_failed",
    );
  });
});
