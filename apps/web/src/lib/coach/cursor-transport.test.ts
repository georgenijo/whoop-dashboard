import { afterEach, describe, expect, it, vi } from "vitest";
import { cursorTransport } from "./cursor-transport";

afterEach(() => vi.unstubAllEnvs());

describe("cursorTransport", () => {
  it("defaults safely to legacy and enables ACP only explicitly", () => {
    vi.stubEnv("COACH_CURSOR_TRANSPORT", "");
    expect(cursorTransport()).toBe("legacy");
    vi.stubEnv("COACH_CURSOR_TRANSPORT", "acp");
    expect(cursorTransport()).toBe("acp");
    vi.stubEnv("COACH_CURSOR_TRANSPORT", "unexpected");
    expect(cursorTransport()).toBe("legacy");
  });
});
