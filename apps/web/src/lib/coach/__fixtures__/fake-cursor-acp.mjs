#!/usr/bin/env node

import readline from "node:readline";

let model = "gpt-5.6-luna";
let reasoning = "low";
let contextWindow = "1m";
let fast = false;
let totalInput = 0;
let totalOutput = 0;
let pendingPrompt = null;
const scenario = process.env.FAKE_CURSOR_ACP_SCENARIO ?? "normal";

if (scenario === "startup-error") {
  process.stderr.write(
    `FIRST key_test must be redacted\n${"x".repeat(5_000)}\nTAIL diagnostic`,
  );
  process.exit(1);
}
if (scenario === "startup-split-secret") {
  process.stderr.write("FIRST key_");
  await new Promise((resolve) => setTimeout(resolve, 10));
  process.stderr.write("test TAIL diagnostic");
  process.exit(1);
}

function configOptions() {
  return [
    {
      type: "select",
      id: "model",
      name: "Model",
      category: "model",
      currentValue: model,
      options: [
        { value: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
        { value: "grok-4.6", name: "Grok 4.6" },
      ],
    },
    {
      type: "select",
      id: "reasoning",
      name: "Reasoning",
      category: "thought_level",
      currentValue: reasoning,
      options: [
        { value: "low", name: "Low" },
        { value: "high", name: "High" },
      ],
    },
    {
      type: "select",
      id: "context",
      name: "Context",
      category: "model_config",
      currentValue: contextWindow,
      options: [
        { value: "200k", name: "200K" },
        { value: "1m", name: "1M" },
      ],
    },
    {
      type: "boolean",
      id: "fast",
      name: "Fast",
      category: "model_config",
      currentValue: fast,
    },
  ];
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function sessionUpdate(update) {
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: "session-1", update },
  });
}

function finishPrompt(id, prompt) {
  if (prompt.includes("USE_TOOL")) {
    sessionUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      name: "mcp__whoop__query_recovery",
      title: "Query recovery",
      status: "in_progress",
      rawInput: { start_date: "2026-08-18", end_date: "2026-08-18" },
    });
    sessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-1",
      status: "completed",
      rawOutput: {
        content: [
          { type: "text", text: JSON.stringify([{ recovery_score: 81 }]) },
        ],
        isError: false,
      },
    });
    sessionUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Tool answer." },
    });
  } else {
    sessionUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `ACP answer from ${model}.` },
    });
  }
  totalInput += 10;
  totalOutput += 5;
  result(id, {
    stopReason: "end_turn",
    usage: {
      totalTokens: totalInput + totalOutput,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cachedReadTokens: 2,
      cachedWriteTokens: 1,
    },
  });
}

async function handle(message) {
  const { id, method, params = {} } = message;
  switch (method) {
    case "initialize":
      result(id, {
        protocolVersion: 1,
        agentInfo: { name: "fake-cursor", version: "2026.08.18" },
        agentCapabilities: {
          mcpCapabilities: {},
          sessionCapabilities: { close: {} },
        },
        authMethods: [{ id: "cursor_login", name: "Cursor login" }],
      });
      return;
    case "authenticate":
      if (scenario === "auth-error") {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32001, message: "Unauthorized invalid key_test" },
        });
        return;
      }
      result(id, {});
      return;
    case "session/new":
      result(id, {
        sessionId: "session-1",
        modes: {
          currentModeId: "agent",
          availableModes: [
            { id: "agent", name: "Agent" },
            { id: "ask", name: "Ask" },
          ],
        },
        configOptions: configOptions(),
      });
      return;
    case "session/set_mode":
      result(id, {});
      return;
    case "session/set_config_option": {
      const { configId, value } = params;
      if (scenario === "config-hang" && configId === "model") return;
      if (scenario === "config-error" && configId === "reasoning") {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32002, message: "Configuration failed" },
        });
        return;
      }
      if (configId === "model") model = value;
      if (configId === "reasoning") reasoning = value;
      if (configId === "context") contextWindow = value;
      if (configId === "fast") fast = value;
      result(id, { configOptions: configOptions() });
      return;
    }
    case "cursor/list_available_models":
      if (scenario === "catalog-hang") return;
      result(id, {
        models: [
          {
            value: "gpt-5.6-luna",
            name: "GPT-5.6 Luna",
            configOptions: configOptions().slice(1),
          },
          {
            value: "grok-4.6",
            name: "Grok 4.6",
            configOptions: configOptions().slice(1),
          },
        ],
      });
      return;
    case "session/prompt": {
      const prompt =
        params.prompt?.map((block) => block.text ?? "").join("") ?? "";
      if (scenario === "exit-before-event") {
        process.stderr.write("FIRST prompt failure\nTAIL prompt failure");
        process.exit(2);
      } else if (scenario === "malformed-response") {
        process.stdout.write("{not-json}\n");
        process.exit(2);
      } else if (scenario === "slow") {
        pendingPrompt = { id, prompt };
      } else {
        finishPrompt(id, prompt);
      }
      return;
    }
    case "session/cancel":
      if (pendingPrompt) {
        result(pendingPrompt.id, { stopReason: "cancelled" });
        pendingPrompt = null;
      }
      return;
    case "session/close":
      result(id, {});
      return;
    default:
      if (id !== undefined) {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
      }
  }
}

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (!line.trim()) return;
  void handle(JSON.parse(line));
});
