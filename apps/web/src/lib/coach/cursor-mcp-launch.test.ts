// @vitest-environment node
//
// ACP sessions must launch the precompiled Coach MCP server (issue #552):
// a persistent session cannot fall back to the per-turn tsx path.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getUserSettings: vi.fn(() => null) }));
vi.mock("@/lib/db/connection", () => ({ dbPath: () => "/tmp/whoop-test.db" }));
vi.mock("./prompts", () => ({ buildCursorSystemPrompt: () => "System" }));

const dirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function loadWithCompiledPath(exists: boolean) {
  const dir = await mkdtemp(path.join(tmpdir(), "coach-mcp-launch-"));
  dirs.push(dir);
  const compiled = path.join(dir, "server.mjs");
  if (exists) await writeFile(compiled, "export {};\n");
  vi.stubEnv("COACH_MCP_COMPILED_PATH", compiled);
  vi.stubEnv("COACH_MCP_SERVER_PATH", "");
  vi.resetModules();
  const loop = await import("./cursor-loop");
  return { loop, compiled };
}

describe("ACP MCP server launch", () => {
  it("uses the compiled server when ACP requires it", async () => {
    const { loop, compiled } = await loadWithCompiledPath(true);
    expect(loop.resolveMcpServerArgs(true)).toEqual([
      "--conditions=react-server",
      compiled,
    ]);
  });

  it("fails closed instead of falling back to tsx when the build is missing", async () => {
    const { loop } = await loadWithCompiledPath(false);
    expect(() => loop.resolveMcpServerArgs(true)).toThrow(
      "requires the compiled Coach MCP server",
    );
    // The legacy per-turn path still has its tsx fallback.
    expect(loop.resolveMcpServerArgs()).toContain("tsx");
  });
});
