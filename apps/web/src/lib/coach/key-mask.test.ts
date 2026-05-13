import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { maskAnthropicKey } from "./key-mask";

describe("maskAnthropicKey", () => {
  it("renders sk-ant-…XXXX for a typical-length key (only the last 4 leak)", () => {
    const key = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA-W4nT";
    const out = maskAnthropicKey(key);
    expect(out).toBe("sk-ant-…W4nT");
    // Defense-in-depth: nothing but the trailing 4 chars from the input
    // appears in the output beyond the literal "sk-ant-" prefix.
    expect(out.includes("AAAA")).toBe(false);
  });

  it("handles a short string by using the last 4 chars", () => {
    expect(maskAnthropicKey("abcdef")).toBe("sk-ant-…cdef");
  });

  it("handles an empty string by rendering an empty tail", () => {
    expect(maskAnthropicKey("")).toBe("sk-ant-…");
  });
});
