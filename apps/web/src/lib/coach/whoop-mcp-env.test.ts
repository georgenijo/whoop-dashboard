// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { whoopMcpEnv } from "./whoop-mcp-env";

afterEach(() => vi.unstubAllEnvs());

describe("Whoop MCP environment", () => {
  it("provides vault/OAuth credentials while excluding unrelated secrets", () => {
    vi.stubEnv("VAULT_KEY", "synthetic-vault-key");
    vi.stubEnv("WHOOP_CLIENT_ID", "synthetic-client");
    vi.stubEnv("WHOOP_CLIENT_SECRET", "synthetic-client-secret");
    vi.stubEnv("JWT_SIGNING_KEY", "must-not-pass");
    vi.stubEnv("CURSOR_API_KEY", "must-not-pass");
    vi.stubEnv("ANTHROPIC_API_KEY", "must-not-pass");
    vi.stubEnv("NODE_ENV", "production");
    expect(whoopMcpEnv()).toEqual({
      NODE_ENV: "production",
      VAULT_KEY: "synthetic-vault-key",
      WHOOP_CLIENT_ID: "synthetic-client",
      WHOOP_CLIENT_SECRET: "synthetic-client-secret",
    });
  });

  it("does not invent credentials in builds or unconfigured environments", () => {
    for (const name of ["VAULT_KEY", "WHOOP_CLIENT_ID", "WHOOP_CLIENT_SECRET", "NODE_ENV"]) {
      vi.stubEnv(name, undefined);
    }
    expect(whoopMcpEnv()).toEqual({ NODE_ENV: "production" });
  });
});
