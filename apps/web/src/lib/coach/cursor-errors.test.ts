import { describe, expect, it } from "vitest";
import { describeCursorExit } from "./cursor-errors";

describe("describeCursorExit", () => {
  it("names the signal for a signal death", () => {
    expect(describeCursorExit({ code: null, signal: "SIGKILL" })).toBe("killed by SIGKILL");
  });
  it("keeps the numeric code for an ordinary exit", () => {
    expect(describeCursorExit({ code: 1, signal: null })).toBe("exited 1");
  });
  it("still reads 'exited null' only when Node reports neither", () => {
    expect(describeCursorExit({ code: null, signal: null })).toBe("exited null");
  });
});
