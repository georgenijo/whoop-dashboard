#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tools = JSON.parse(
  readFileSync(
    path.join(
      repoRoot,
      "apps/web/src/lib/coach/cursor-launcher-tools.json",
    ),
    "utf8",
  ),
);
const requestedAgent =
  process.argv[2] ||
  process.env.COACH_CURSOR_AGENT_BIN ||
  path.join(process.env.HOME || "", ".local/bin/cursor-agent");

function fail(message) {
  process.stderr.write(`Cursor Agent canary failed: ${message}\n`);
  process.exitCode = 1;
}

function executableAt(candidate) {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExecutable(command, pathValue) {
  if (path.isAbsolute(command)) {
    return executableAt(command) ? command : null;
  }
  for (const directory of (pathValue || "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, command);
    if (executableAt(candidate)) return candidate;
  }
  return null;
}

function validToolName(tool) {
  return (
    typeof tool === "string" &&
    tool.length > 0 &&
    tool !== "." &&
    tool !== ".." &&
    path.basename(tool) === tool
  );
}

if (
  !Array.isArray(tools) ||
  !tools.every(validToolName) ||
  new Set(tools).size !== tools.length
) {
  fail("launcher tool manifest is invalid");
} else {
  const agentBin = resolveExecutable(requestedAgent, process.env.PATH);
  if (!agentBin) {
    fail(
      `${requestedAgent} is missing or not executable; install it with ` +
        "curl https://cursor.com/install -fsS | bash",
    );
  } else {
    const shimDir = mkdtempSync(path.join(tmpdir(), "coach-cursor-canary-"));
    try {
      let ready = true;
      const searchPath = [
        process.env.PATH || "",
        "/usr/bin",
        "/bin",
        "/usr/local/bin",
      ].join(path.delimiter);
      for (const tool of tools) {
        const source = resolveExecutable(tool, searchPath);
        if (!source) {
          fail(`required launcher tool '${tool}' is unavailable`);
          ready = false;
          break;
        }
        symlinkSync(source, path.join(shimDir, tool));
      }

      if (ready) {
        const result = spawnSync(agentBin, ["--version"], {
          encoding: "utf8",
          env: { ...process.env, PATH: shimDir },
          timeout: 15_000,
        });
        if (result.error) {
          fail(result.error.message);
        } else if (result.status !== 0) {
          const detail = (result.stderr || result.stdout || "no output").trim();
          fail(`launcher exited ${result.status}: ${detail}`);
        } else {
          const version = result.stdout.trim() || "version unknown";
          process.stdout.write(`Cursor Agent canary ok (${version})\n`);
        }
      }
    } finally {
      rmSync(shimDir, { recursive: true, force: true });
    }
  }
}
