#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";

const agentBin =
  process.argv[2] ||
  process.env.COACH_CURSOR_AGENT_BIN ||
  path.join(process.env.HOME || "", ".local/bin/cursor-agent");
const agentCommand = path.isAbsolute(agentBin)
  ? agentBin
  : path.resolve(process.cwd(), agentBin);
const targetModel = process.argv[3] || "";
const apiKey = process.env.CURSOR_API_KEY;

if (!apiKey) {
  process.stderr.write("Cursor ACP canary failed: CURSOR_API_KEY is not set\n");
  process.exit(1);
}

const workspace = await mkdtemp(
  path.join(tmpdir(), "coach-cursor-acp-canary-"),
);
const endpoint = process.env.CURSOR_BACKEND_URL?.trim();
const child = spawn(
  agentCommand,
  [...(endpoint ? ["-e", endpoint] : []), "acp"],
  {
    cwd: workspace,
    env: { ...process.env, CURSOR_API_KEY: apiKey },
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  },
);
let nextId = 1;
let stderr = "";
const pending = new Map();

child.on("error", (error) => {
  for (const request of pending.values()) request.reject(error);
  pending.clear();
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-2_000);
});
const lines = readline.createInterface({ input: child.stdout });
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (!("id" in message)) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) {
    request.reject(new Error(`${request.method}: ${message.error.message}`));
  } else {
    request.resolve(message.result);
  }
});

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method}: timed out`));
    }, 15_000);
    pending.set(id, {
      method,
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
  });
}

async function terminate() {
  if (
    child.pid === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return;
  }
  const closed = new Promise((resolve) => child.once("close", resolve));
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  let graceTimer;
  const exited = await Promise.race([
    closed.then(() => true),
    new Promise((resolve) => {
      graceTimer = setTimeout(() => resolve(false), 5_000);
      graceTimer.unref?.();
    }),
  ]);
  if (graceTimer) clearTimeout(graceTimer);
  if (exited) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
  await Promise.race([
    closed,
    new Promise((resolve) => setTimeout(resolve, 250)),
  ]);
}

try {
  const initialized = await request("initialize", {
    protocolVersion: 1,
    clientInfo: { name: "whoop-coach-canary", version: "1.0.0" },
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
      _meta: { parameterizedModelPicker: true },
    },
  });
  await request("authenticate", { methodId: "cursor_login" });
  const session = await request("session/new", {
    cwd: workspace,
    mcpServers: [],
  });
  const catalog = await request("cursor/list_available_models", {});
  if (!catalog || !Array.isArray(catalog.models)) {
    throw new Error(
      "cursor/list_available_models returned an invalid response",
    );
  }
  const models = catalog.models
    .filter((model) => model && typeof model.value === "string")
    .map((model) => model.value);
  if (targetModel && !models.includes(targetModel)) {
    throw new Error(`target model is unavailable: ${targetModel}`);
  }
  if (
    initialized?.agentCapabilities?.sessionCapabilities?.close &&
    session?.sessionId
  ) {
    await request("session/close", { sessionId: session.sessionId });
  }
  const version = initialized?.agentInfo?.version || "unknown";
  process.stdout.write(
    `Cursor ACP canary ok (version=${version}, models=${models.length}${
      targetModel ? `, target=${targetModel}` : ""
    })\n`,
  );
} catch (error) {
  const safeStderr = stderr
    .replaceAll(apiKey, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .trim();
  process.stderr.write(
    `Cursor ACP canary failed: ${
      error instanceof Error ? error.message : String(error)
    }${safeStderr ? `; ${safeStderr}` : ""}\n`,
  );
  process.exitCode = 1;
} finally {
  await terminate();
  await rm(workspace, { recursive: true, force: true });
}
