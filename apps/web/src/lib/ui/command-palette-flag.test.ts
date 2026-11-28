import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isCommandPaletteEnabled } from "./command-palette-flag";

describe("isCommandPaletteEnabled", () => {
  it("is off by default", () => {
    expect(isCommandPaletteEnabled({})).toBe(false);
  });
  it("is on only for exactly '1'", () => {
    expect(isCommandPaletteEnabled({ COMMAND_PALETTE: "1" })).toBe(true);
    for (const v of ["0", "true", "yes", " 1", ""]) {
      expect(isCommandPaletteEnabled({ COMMAND_PALETTE: v })).toBe(false);
    }
  });
});
