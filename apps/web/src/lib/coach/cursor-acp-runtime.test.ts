// @vitest-environment node
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  CursorAcpRuntime,
  cursorAcpPermissionResponse,
} from "./cursor-acp-runtime";

const fixture = fileURLToPath(
  new URL("./__fixtures__/fake-cursor-acp.mjs", import.meta.url),
);
const runtimes: CursorAcpRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

async function start(scenario = "normal") {
  const runtime = await CursorAcpRuntime.start({
    userId: 7,
    key: "key_test",
    keyOrigin: "user",
    credentialFingerprint: "credential",
    promptFingerprint: "prompt",
    withMcp: false,
    agentBin: process.execPath,
    agentArgs: [fixture],
    agentEnv: { FAKE_CURSOR_ACP_SCENARIO: scenario },
  });
  runtimes.push(runtime);
  return runtime;
}

describe("CursorAcpRuntime", () => {
  it("discovers and applies GPT-5.6 Luna through the same ACP runtime", async () => {
    const runtime = await start();
    const catalog = await runtime.listAvailableModels();
    expect(catalog.models.map((model) => model.value)).toContain(
      "gpt-5.6-luna",
    );

    await runtime.applyModel("gpt-5.6-luna", [
      { id: "reasoning", value: "high" },
      { id: "context", value: "1m" },
      { id: "fast", value: "false" },
    ]);
    const updates: string[] = [];
    const response = await runtime.prompt(
      "hello",
      undefined,
      (notification) => {
        updates.push(notification.update.sessionUpdate);
      },
    );

    expect(response.stopReason).toBe("end_turn");
    expect(updates).toContain("agent_message_chunk");
    expect(runtime.diagnostics.resolvedModel).toBe("gpt-5.6-luna");
    expect(runtime.diagnostics.appliedParameters).toEqual([
      { id: "reasoning", value: "high" },
      { id: "context", value: "1m" },
      { id: "fast", value: "false" },
    ]);

    expect(runtime.usageDelta(response.usage)).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
    });
    await runtime.applyModel("grok-4.6", [{ id: "reasoning", value: "low" }]);
    const second = await runtime.prompt("second", undefined, () => {});
    expect(runtime.diagnostics.resolvedModel).toBe("grok-4.6");
    expect(runtime.usageDelta(second.usage)).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  it("sends a real session cancellation and retires the now-divergent session", async () => {
    const runtime = await start("slow");
    await runtime.applyModel("gpt-5.6-luna", []);
    const controller = new AbortController();
    const pending = runtime.prompt("wait", controller.signal, () => {});
    setTimeout(() => controller.abort(new Error("test abort")), 20);
    await expect(pending).rejects.toThrow("test abort");
    expect(runtime.isHealthy()).toBe(false);
    expect(runtime.diagnostics.process).toMatchObject({
      cancelled: true,
      timedOut: false,
    });
  });

  it("allows only explicitly named Coach MCP tools", () => {
    const options = [
      { optionId: "allow", name: "Allow", kind: "allow_once" as const },
      { optionId: "reject", name: "Reject", kind: "reject_once" as const },
    ];
    expect(
      cursorAcpPermissionResponse({
        sessionId: "s",
        toolCall: {
          toolCallId: "t",
          name: "mcp__whoop__query_recovery",
        },
        options,
      }).outcome,
    ).toEqual({ outcome: "selected", optionId: "allow" });
    expect(
      cursorAcpPermissionResponse({
        sessionId: "s",
        toolCall: { toolCallId: "t", name: "Shell" },
        options,
      }).outcome,
    ).toEqual({ outcome: "selected", optionId: "reject" });
    expect(
      cursorAcpPermissionResponse({
        sessionId: "s",
        toolCall: {
          toolCallId: "t",
          name: "mcp__untrusted__query_recovery",
        },
        options,
      }).outcome,
    ).toEqual({ outcome: "selected", optionId: "reject" });
  });

  it("retains redacted stderr prefix and tail when startup fails", async () => {
    await expect(
      CursorAcpRuntime.start({
        userId: 7,
        key: "key_test",
        keyOrigin: "user",
        credentialFingerprint: "credential",
        promptFingerprint: "prompt",
        withMcp: false,
        agentBin: process.execPath,
        agentArgs: [fixture],
        agentEnv: { FAKE_CURSOR_ACP_SCENARIO: "startup-error" },
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/FIRST[\s\S]*TAIL diagnostic/),
    });
    try {
      await CursorAcpRuntime.start({
        userId: 7,
        key: "key_test",
        keyOrigin: "user",
        credentialFingerprint: "credential",
        promptFingerprint: "prompt",
        withMcp: false,
        agentBin: process.execPath,
        agentArgs: [fixture],
        agentEnv: { FAKE_CURSOR_ACP_SCENARIO: "startup-error" },
      });
    } catch (error) {
      expect(
        error instanceof Error ? error.message : String(error),
      ).not.toContain("key_test");
    }
  });

  it("fails promptly when the configured agent binary cannot spawn", async () => {
    await expect(
      CursorAcpRuntime.start({
        userId: 7,
        key: "key_test",
        keyOrigin: "user",
        credentialFingerprint: "credential",
        promptFingerprint: "prompt",
        withMcp: false,
        agentBin: "/definitely/missing/cursor-agent",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Cursor ACP startup failed"),
    });
  });

  it("maps an authentication rejection without exposing the credential", async () => {
    await expect(start("auth-error")).rejects.toMatchObject({
      reason: "auth",
      message: "Cursor API key rejected",
    });
  });

  it.each(["exit-before-event", "malformed-response"])(
    "retires the session when the agent fails during a prompt (%s)",
    async (scenario) => {
      const runtime = await start(scenario);
      await runtime.applyModel("gpt-5.6-luna", []);
      await expect(
        runtime.prompt("hello", undefined, () => {}),
      ).rejects.toBeDefined();
      expect(runtime.isHealthy()).toBe(false);
    },
  );
});
