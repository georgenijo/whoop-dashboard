// @vitest-environment node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const canary = path.resolve(
  here,
  "../../../../../scripts/check-cursor-acp.mjs",
);
const fakeAgent = path.resolve(here, "__fixtures__/fake-cursor-acp.mjs");

describe("Cursor ACP authenticated canary", () => {
  it("checks the no-MCP runtime catalog and target model", () => {
    const result = spawnSync(
      process.execPath,
      [canary, fakeAgent, "gpt-5.6-luna"],
      {
        encoding: "utf8",
        env: { ...process.env, CURSOR_API_KEY: "test-key" },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cursor ACP canary ok");
    expect(result.stdout).toContain("target=gpt-5.6-luna");
  });

  it("fails closed without a Cursor credential", () => {
    const env = { ...process.env };
    delete env.CURSOR_API_KEY;
    const result = spawnSync(process.execPath, [canary, fakeAgent], {
      encoding: "utf8",
      env,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CURSOR_API_KEY is not set");
  });
});
