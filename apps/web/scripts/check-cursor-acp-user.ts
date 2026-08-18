import "server-only";

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveCursorKey } from "../src/lib/coach/cursor-key";

async function main(): Promise<void> {
  const userId = Number(process.argv[2]);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("Usage: check-cursor-acp-user.ts <user-id> [agent-bin] [model]");
  }

  const agentBin =
    process.argv[3] ||
    process.env.COACH_CURSOR_AGENT_BIN ||
    path.join(process.env.HOME || "", ".local/bin/cursor-agent");
  const model = process.argv[4] || "gpt-5.6-luna";
  const { key, origin } = resolveCursorKey(userId);
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const canary = path.join(repositoryRoot, "scripts/check-cursor-acp.mjs");
  const childEnv: NodeJS.ProcessEnv = {
    CURSOR_API_KEY: key,
    NODE_ENV: process.env.NODE_ENV,
  };
  for (const name of [
    "HOME",
    "PATH",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "CURSOR_BACKEND_URL",
  ]) {
    const value = process.env[name];
    if (value !== undefined) childEnv[name] = value;
  }

  process.stderr.write(`Cursor ACP canary credential origin: ${origin}\n`);
  const child = spawn(process.execPath, [canary, agentBin, model], {
    cwd: repositoryRoot,
    env: childEnv,
    stdio: "inherit",
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
}

void main().catch((error) => {
  process.stderr.write(
    `Cursor ACP user canary failed: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exitCode = 1;
});
