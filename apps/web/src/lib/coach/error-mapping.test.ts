// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CursorAgentError } from "./cursor-key";
import { classifyChatError } from "./error-mapping";
import { CursorInsufficientMemoryError } from "./cursor-memory";
import { AnthropicModelCatalogError, AnthropicModelUnavailableError } from "./anthropic-models";

it("makes unavailable Anthropic models actionable without a paid fallback", () => {
  expect(classifyChatError(new AnthropicModelUnavailableError()))
    .toMatchObject({ status: 422, message: expect.stringContaining("Choose a model in Settings") });
  expect(classifyChatError(new AnthropicModelCatalogError("unavailable")))
    .toMatchObject({ status: 503, message: expect.stringContaining("discovery is unavailable") });
});

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

describe("classifyChatError — reason", () => {
  it("tags each actionable failure class", () => {
    expect(classifyChatError(new AnthropicModelUnavailableError()).reason).toBe("model_unavailable");
    expect(classifyChatError(new CursorAgentError("timeout", "slow")).reason).toBe("timeout");
    expect(classifyChatError(new CursorAgentError("auth", "no", "env")).reason).toBe("invalid_key");
    expect(classifyChatError(new Error("unknown")).reason).toBeUndefined();
  });
});

describe("classifyChatError — Cursor memory pre-flight (issue #475-A)", () => {
  it("names low memory instead of a bare retry prompt", () => {
    const c = classifyChatError(
      new CursorInsufficientMemoryError({
        available_bytes: 6 * 1024 * 1024,
        host_available_bytes: null,
        cgroup_headroom_bytes: 6 * 1024 * 1024,
        cgroup_limited_by: "/system.slice/whoop-web.service",
        required_bytes: 150 * 1024 * 1024,
        ok: false,
      }),
    );
    expect(c).toMatchObject({ status: 503, kind: "server_error", reason: "out_of_memory" });
    expect(c.message).toMatch(/low on memory/);
    expect(c.message).toMatch(/Switch to a Claude model/);
    expect(c.message).not.toBe("The Cursor coach hit an error. Try again.");
  });
});

describe("classifyChatError — Cursor process signal deaths (issue #475-C)", () => {
  it("tells the user the process was killed, with the signal, instead of a bare retry prompt", () => {
    const c = classifyChatError(
      new CursorAgentError("agent", "cursor-agent killed by SIGKILL: ", undefined, {
        code: null,
        signal: "SIGKILL",
      }),
    );
    expect(c.status).toBe(502);
    expect(c.kind).toBe("upstream_error");
    expect(c.message).toContain("SIGKILL");
    expect(c.message).toMatch(/short on memory/);
    expect(c.reason).toBeUndefined();
  });

  it("calls any other signal a crash and names it", () => {
    const c = classifyChatError(
      new CursorAgentError("agent", "x", undefined, { code: null, signal: "SIGSEGV" }),
    );
    expect(c.message).toBe("The Cursor coach process crashed (SIGSEGV) before it replied. Try again.");
  });

  it("keeps the generic copy for a numeric exit or no exit info", () => {
    const generic = "The Cursor coach hit an error. Try again.";
    expect(
      classifyChatError(new CursorAgentError("agent", "x", undefined, { code: 1, signal: null })).message,
    ).toBe(generic);
    expect(classifyChatError(new CursorAgentError("agent", "x")).message).toBe(generic);
  });
});
