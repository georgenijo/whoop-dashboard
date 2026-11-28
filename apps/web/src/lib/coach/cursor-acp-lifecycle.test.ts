// @vitest-environment node
//
// Process-level lifecycle contracts for the Cursor ACP runtime (issue #552).
// Every case drives the real CursorAcpRuntime against the deterministic fake
// agent and asserts not only the rejected promise but also that the agent's
// whole process group is reaped and its temporary workspace removed.
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { CursorAcpRuntime } from "./cursor-acp-runtime";
import { CursorAgentError } from "./cursor-errors";

const fixture = fileURLToPath(
  new URL("./__fixtures__/fake-cursor-acp.mjs", import.meta.url),
);
const SECRET = "key_test";
const REAP_DEADLINE_MS = 3_000;

type Probe = {
  pid: number;
  cwd: string;
  grandchildPid: number | null;
  hasKey: boolean;
  argv: string[];
};

const runtimes: CursorAcpRuntime[] = [];
const probeDirs: string[] = [];
const probeFiles: string[] = [];

function alive(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readProbe(file: string): Probe {
  return JSON.parse(readFileSync(file, "utf8")) as Probe;
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  // Never leave a child behind when an assertion failed mid-test.
  for (const file of probeFiles.splice(0)) {
    if (!existsSync(file)) continue;
    const probe = readProbe(file);
    for (const pid of [probe.pid, probe.grandchildPid]) {
      if (alive(pid)) process.kill(pid!, "SIGKILL");
    }
  }
  await Promise.all(
    probeDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function probePath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "coach-acp-probe-"));
  probeDirs.push(dir);
  const file = path.join(dir, "probe.json");
  probeFiles.push(file);
  return file;
}

async function launch(
  scenario: string,
  options: { grandchild?: "term" | "stubborn" } = {},
): Promise<{ runtime: CursorAcpRuntime; probeFile: string }> {
  const probeFile = await probePath();
  const runtime = await CursorAcpRuntime.start({
    userId: 7,
    key: SECRET,
    keyOrigin: "user",
    credentialFingerprint: "credential",
    promptFingerprint: "prompt",
    withMcp: false,
    agentBin: process.execPath,
    agentArgs: [fixture],
    agentEnv: {
      FAKE_CURSOR_ACP_SCENARIO: scenario,
      FAKE_CURSOR_ACP_PROBE_FILE: probeFile,
      FAKE_CURSOR_ACP_GRANDCHILD: options.grandchild,
    },
  });
  runtimes.push(runtime);
  return { runtime, probeFile };
}

async function startupFailure(scenario: string) {
  const probeFile = await probePath();
  const error = await CursorAcpRuntime.start({
    userId: 7,
    key: SECRET,
    keyOrigin: "user",
    credentialFingerprint: "credential",
    promptFingerprint: "prompt",
    withMcp: false,
    agentBin: process.execPath,
    agentArgs: [fixture],
    agentEnv: {
      FAKE_CURSOR_ACP_SCENARIO: scenario,
      FAKE_CURSOR_ACP_PROBE_FILE: probeFile,
      FAKE_CURSOR_ACP_GRANDCHILD: "stubborn",
    },
  }).then(
    (runtime) => {
      runtimes.push(runtime);
      throw new Error(`Cursor ACP startup unexpectedly resolved (${scenario})`);
    },
    (reason: unknown) => reason,
  );
  return { error, probeFile };
}

async function expectReaped(probeFile: string): Promise<void> {
  const probe = readProbe(probeFile);
  await vi.waitFor(
    () => {
      expect(alive(probe.pid)).toBe(false);
      expect(alive(probe.grandchildPid)).toBe(false);
      expect(existsSync(probe.cwd)).toBe(false);
    },
    { timeout: REAP_DEADLINE_MS, interval: 20 },
  );
}

function textOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe("Cursor ACP runtime lifecycle", () => {
  it("passes the credential via environment only and reaps on dispose", async () => {
    const { runtime, probeFile } = await launch("normal", {
      grandchild: "term",
    });
    const probe = readProbe(probeFile);
    expect(probe.hasKey).toBe(true);
    expect(probe.argv.join(" ")).not.toContain(SECRET);
    expect(alive(probe.pid)).toBe(true);
    expect(alive(probe.grandchildPid)).toBe(true);
    expect(probe.cwd).toBe(runtime.workspace.root);

    await runtime.dispose();
    await expectReaped(probeFile);
    expect(runtime.isHealthy()).toBe(false);
  });

  it("reaps a descendant that ignores SIGTERM", async () => {
    const { runtime, probeFile } = await launch("normal", {
      grandchild: "stubborn",
    });
    expect(alive(readProbe(probeFile).grandchildPid)).toBe(true);

    await runtime.dispose();
    await expectReaped(probeFile);
  });

  describe("startup failures", () => {
    it.each(["auth-error", "auth-required"])(
      "maps %s at session creation to an auth failure and cleans up",
      async (scenario) => {
        const { error, probeFile } = await startupFailure(scenario);
        expect(error).toBeInstanceOf(CursorAgentError);
        expect(error).toMatchObject({ reason: "auth", origin: "user" });
        expect(textOf(error)).toBe("Cursor API key rejected");
        expect(textOf(error)).not.toContain(SECRET);
        await expectReaped(probeFile);
      },
    );

    it("reaps an agent that exits during startup", async () => {
      const { error, probeFile } = await startupFailure("startup-error");
      expect(error).toMatchObject({ reason: "agent" });
      expect(textOf(error)).not.toContain(SECRET);
      await expectReaped(probeFile);
    });
  });

  describe("model configuration failures", () => {
    it("retires and reaps a session whose agent exits during model config", async () => {
      const { runtime, probeFile } = await launch("config-exit", {
        grandchild: "stubborn",
      });
      await expect(
        runtime.applyModel("gpt-5.6-luna", []),
      ).rejects.toBeDefined();
      expect(runtime.isHealthy()).toBe(false);
      await expectReaped(probeFile);
      expect(runtime.diagnostics.process.exitCode).toBe(3);
    });

    it("retires a session when a catalog model is gone by the time it is applied", async () => {
      const { runtime, probeFile } = await launch("model-removed");
      const catalog = await runtime.listAvailableModels();
      expect(catalog.models.map((model) => model.value)).toContain("grok-4.6");

      await expect(runtime.applyModel("grok-4.6", [])).rejects.toThrow(
        "Model not found",
      );
      expect(runtime.isHealthy()).toBe(false);
      await expectReaped(probeFile);
    });

    it("rejects a model the live session never advertised without touching the session", async () => {
      const { runtime } = await launch("normal");
      await expect(runtime.applyModel("gpt-retired", [])).rejects.toThrow(
        "not available in the active ACP runtime",
      );
      // Nothing was sent to the agent, so the session stays usable.
      expect(runtime.isHealthy()).toBe(true);
      await runtime.applyModel("gpt-5.6-luna", []);
      const response = await runtime.prompt("hello", undefined, () => {});
      expect(response.stopReason).toBe("end_turn");
    });
  });

  describe("prompt failures", () => {
    it.each([
      ["exit-before-event", "exit before the first event"],
      ["crash-mid-tool", "crash while a tool call is in progress"],
      ["truncated-response", "a truncated JSON-RPC frame"],
      ["malformed-response", "a malformed JSON-RPC frame"],
    ])(
      "classifies %s (%s), retires the session, and reaps the tree",
      async (scenario) => {
        // A SIGTERM-ignoring descendant: once the agent itself has died,
        // only the process-group reap can collect it.
        const { runtime, probeFile } = await launch(scenario, {
          grandchild: "stubborn",
        });
        await runtime.applyModel("gpt-5.6-luna", []);
        const updates: string[] = [];
        const error = await runtime
          .prompt("hello", undefined, (notification) => {
            updates.push(notification.update.sessionUpdate);
          })
          .then(
            () => {
              throw new Error("prompt unexpectedly resolved");
            },
            (reason: unknown) => reason,
          );

        expect(error).toBeInstanceOf(CursorAgentError);
        expect(error).toMatchObject({ reason: "agent" });
        expect(textOf(error)).toContain("Cursor ACP prompt failed");
        expect(textOf(error)).not.toContain(SECRET);
        if (scenario === "crash-mid-tool") {
          expect(updates).toEqual(["tool_call"]);
        }
        expect(runtime.isHealthy()).toBe(false);
        await expectReaped(probeFile);
      },
    );

    it("tolerates a stray non-JSON line and completes the turn", async () => {
      const { runtime } = await launch("garbage-line");
      await runtime.applyModel("gpt-5.6-luna", []);
      const chunks: string[] = [];
      const response = await runtime.prompt("hello", undefined, (n) => {
        if (
          n.update.sessionUpdate === "agent_message_chunk" &&
          n.update.content.type === "text"
        ) {
          chunks.push(n.update.content.text);
        }
      });
      expect(response.stopReason).toBe("end_turn");
      expect(chunks.join("")).toContain("ACP answer");
      expect(runtime.isHealthy()).toBe(true);
    });

    it("redacts a credential split across stderr chunks in a prompt failure", async () => {
      const { runtime, probeFile } = await launch("prompt-split-secret");
      await runtime.applyModel("gpt-5.6-luna", []);
      const error = await runtime
        .prompt("hello", undefined, () => {})
        .then(
          () => {
            throw new Error("prompt unexpectedly resolved");
          },
          (reason: unknown) => reason,
        );
      expect(textOf(error)).toContain("prompt failure");
      expect(textOf(error)).not.toContain(SECRET);
      expect(runtime.diagnostics.stderr).not.toContain(SECRET);
      await expectReaped(probeFile);
    });
  });

  it(
    "escalates an ignored cancellation to SIGKILL and reaps the tree",
    async () => {
      const { runtime, probeFile } = await launch("cancel-ignored", {
        grandchild: "stubborn",
      });
      await runtime.applyModel("gpt-5.6-luna", []);
      const controller = new AbortController();
      const reason = new Error("user stopped");
      const pending = runtime.prompt("wait", controller.signal, (n) => {
        // Synchronize on the agent's first event instead of sleeping.
        if (n.update.sessionUpdate === "agent_message_chunk") {
          controller.abort(reason);
        }
      });

      await expect(pending).rejects.toBe(reason);
      expect(runtime.isHealthy()).toBe(false);
      await expectReaped(probeFile);
      expect(runtime.diagnostics.process).toMatchObject({
        cancelled: true,
        timedOut: false,
        signal: "SIGKILL",
      });
    },
    // Two production grace windows (cancel → dispose, SIGTERM → SIGKILL) of
    // 5s each. Kept real on purpose: shrinking them only for tests would stop
    // this from pinning the shipped escalation path.
    20_000,
  );

  it("treats a backwards cumulative usage counter as a reset, not a free turn", async () => {
    const { runtime } = await launch("usage-reset");
    await runtime.applyModel("gpt-5.6-luna", []);
    const deltas = [];
    for (const text of ["one", "two", "three"]) {
      const response = await runtime.prompt(text, undefined, () => {});
      deltas.push(runtime.usageDelta(response.usage));
    }
    for (const delta of deltas) {
      expect(delta).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    }
  });
});
