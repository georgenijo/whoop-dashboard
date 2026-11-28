// @vitest-environment node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cursorAcpCanaryChildEnv } from "./cursor-acp-canary-env";

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

  it("redacts a credential split across agent stderr chunks when the canary fails", () => {
    const result = spawnSync(process.execPath, [canary, fakeAgent], {
      encoding: "utf8",
      env: {
        ...process.env,
        CURSOR_API_KEY: "key_test",
        FAKE_CURSOR_ACP_SCENARIO: "startup-split-secret",
      },
      timeout: 30_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cursor ACP canary failed");
    expect(result.stderr).toContain("[redacted]");
    expect(`${result.stdout}${result.stderr}`).not.toContain("key_test");
  });

  it("fails closed when the target model is not in the live catalog", () => {
    const result = spawnSync(
      process.execPath,
      [canary, fakeAgent, "gpt-retired"],
      {
        encoding: "utf8",
        env: { ...process.env, CURSOR_API_KEY: "test-key" },
        timeout: 30_000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("target model is unavailable: gpt-retired");
  });
});

describe("cursorAcpCanaryChildEnv", () => {
  it("forwards only the allowlisted environment plus the resolved key", () => {
    const env = cursorAcpCanaryChildEnv(
      {
        HOME: "/home/coach",
        PATH: "/usr/bin",
        LANG: "C.UTF-8",
        NODE_ENV: "production",
        CURSOR_BACKEND_URL: "https://cursor.example.invalid",
        CURSOR_API_KEY: "ambient-key-must-not-win",
        JWT_SIGNING_KEY: "synthetic-jwt",
        VAULT_KEY: "synthetic-vault",
        ANTHROPIC_API_KEY: "synthetic-anthropic",
        WHOOP_CLIENT_SECRET: "synthetic-whoop",
        WHOOP_REFRESH_SECRET: "synthetic-refresh",
      },
      "resolved-user-key",
    );
    expect(env).toEqual({
      CURSOR_API_KEY: "resolved-user-key",
      NODE_ENV: "production",
      HOME: "/home/coach",
      PATH: "/usr/bin",
      LANG: "C.UTF-8",
      CURSOR_BACKEND_URL: "https://cursor.example.invalid",
    });
  });
});
