// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CursorAgentError } from "./cursor-key";
import { classifyChatError } from "./error-mapping";

describe("classifyChatError — Cursor key origin", () => {
  it("points a rejected personal key back to Settings", () => {
    expect(
      classifyChatError(
        new CursorAgentError("auth", "Cursor API key rejected", "user"),
      ),
    ).toMatchObject({
      status: 401,
      kind: "bad_api_key",
      origin: "user",
      message: "Your Cursor API key was rejected. Update it in Settings.",
    });
  });

  it("keeps shared-key failures operator-targeted", () => {
    expect(
      classifyChatError(
        new CursorAgentError("auth", "Cursor API key rejected", "env"),
      ),
    ).toMatchObject({
      status: 502,
      kind: "upstream_error",
      origin: "env",
      message:
        "The server's Cursor API key was rejected. Add a personal key in Settings.",
    });
  });
});
