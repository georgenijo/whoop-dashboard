// @vitest-environment node
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const canaryScript = path.resolve(
  process.cwd(),
  "../../scripts/check-cursor-agent.mjs",
);

async function withFakeAgent(
  body: string,
  run: (agentPath: string) => void,
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "cursor-canary-test-"));
  const agentPath = path.join(dir, "cursor-agent");
  try {
    await writeFile(agentPath, body);
    await chmod(agentPath, 0o755);
    run(agentPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runCanary(agentPath: string) {
  return spawnSync(process.execPath, [canaryScript, agentPath], {
    encoding: "utf8",
  });
}

describe("Cursor Agent launcher canary", () => {
  it("passes a launcher that only uses the production shim tools", async () => {
    await withFakeAgent(
      "#!/usr/bin/env bash\nset -euo pipefail\nbasename \"$0\" >/dev/null\nprintf 'test-agent 1.0\\n'\n",
      (agentPath) => {
        const result = runCanary(agentPath);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("Cursor Agent canary ok (test-agent 1.0)");
      },
    );
  });

  it("fails clearly when the configured binary is absent", () => {
    const result = runCanary("/definitely/missing/cursor-agent");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is missing or not executable");
  });

  it("rejects a launcher that adds a command outside the production shim", async () => {
    await withFakeAgent(
      "#!/usr/bin/env bash\nset -euo pipefail\nuname >/dev/null\nprintf 'unreachable\\n'\n",
      (agentPath) => {
        const result = runCanary(agentPath);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("launcher exited");
        expect(result.stderr).toContain("uname: command not found");
      },
    );
  });
});
