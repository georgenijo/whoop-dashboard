// @vitest-environment node
import { access, appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const dependencies = vi.hoisted(() => ({
  dbPath: vi.fn(() => "/tmp/whoop-test.db"),
  prepareCursorShimBin: vi.fn(async (root: string) => path.join(root, "shim")),
  removeCursorProjectRegistration: vi.fn(async () => {}),
  resolveMcpServerArgs: vi.fn(() => ["server.mjs"]),
}));
vi.mock("@/lib/db/connection", () => ({ dbPath: dependencies.dbPath }));
vi.mock("./cursor-loop", () => ({
  CURSOR_APP_ROOT: "/tmp/coach-app",
  prepareCursorShimBin: dependencies.prepareCursorShimBin,
  removeCursorProjectRegistration: dependencies.removeCursorProjectRegistration,
  resolveMcpServerArgs: dependencies.resolveMcpServerArgs,
  shimBinDirFor: vi.fn((root: string) => path.join(root, "shim")),
}));

import {
  createCursorAcpWorkspace,
  type CursorAcpWorkspace,
} from "./cursor-acp-workspace";

const workspaces: CursorAcpWorkspace[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => workspace.dispose()),
  );
  vi.clearAllMocks();
});

describe("createCursorAcpWorkspace", () => {
  it("keeps catalog probes isolated from the Whoop MCP and database", async () => {
    const workspace = await createCursorAcpWorkspace(7, false);
    workspaces.push(workspace);

    expect(workspace.mcpServer).toBeNull();
    expect(dependencies.dbPath).not.toHaveBeenCalled();
    expect(dependencies.resolveMcpServerArgs).not.toHaveBeenCalled();
  });

  it("publishes a new parent-controlled epoch for each prepared turn", async () => {
    const workspace = await createCursorAcpWorkspace(7, true);
    workspaces.push(workspace);
    const epochPath = path.join(workspace.root, ".coach-turn-epoch");
    const firstEpoch = await readFile(epochPath, "utf8");

    await workspace.prepareTurn([]);
    const secondEpoch = await readFile(epochPath, "utf8");

    expect(secondEpoch).not.toBe(firstEpoch);
    expect(workspace.mcpServer).toMatchObject({
      name: "whoop",
      args: ["server.mjs"],
      env: expect.arrayContaining([
        expect.objectContaining({ name: "COACH_MCP_AUDIT_PATH" }),
        expect.objectContaining({ name: "COACH_MCP_AUDIT_RUNTIME_ID" }),
      ]),
    });
    expect(dependencies.dbPath).toHaveBeenCalledOnce();
    expect(dependencies.resolveMcpServerArgs).toHaveBeenCalledWith(true);
  });

  it("removes the temporary tree when project deregistration fails", async () => {
    dependencies.removeCursorProjectRegistration.mockRejectedValueOnce(
      new Error("deregistration failed"),
    );
    const workspace = await createCursorAcpWorkspace(7, false);

    await expect(workspace.dispose()).rejects.toThrow("deregistration failed");
    await expect(access(workspace.root)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rotates exact audit events across turns in one persistent workspace", async () => {
    const workspace = await createCursorAcpWorkspace(7, true);
    workspaces.push(workspace);
    const mcpServer = workspace.mcpServer as {
      env?: Array<{ name: string; value: string }>;
    } | null;
    const env = Object.fromEntries(
      mcpServer?.env?.map(({ name, value }) => [name, value]) ?? [],
    );
    const auditPath = env.COACH_MCP_AUDIT_PATH;
    const runtimeId = env.COACH_MCP_AUDIT_RUNTIME_ID;
    expect(auditPath).toBeTruthy();
    expect(runtimeId).toBeTruthy();
    const received: string[] = [];

    const firstEpoch = await workspace.prepareTurn([]);
    const first = workspace.auditChannel.listen(
      firstEpoch,
      (event) => received.push(event.call_id),
      (error) => {
        throw error;
      },
    );
    await appendFile(
      auditPath,
      `${JSON.stringify({
        version: 1,
        runtime_id: runtimeId,
        turn_epoch: firstEpoch,
        call_id: "first",
        tool_name: "query_recovery",
        phase: "start",
        at_ms: 1,
        input: {},
      })}\n`,
    );
    await first.drainAndStop();

    const secondEpoch = await workspace.prepareTurn([]);
    const second = workspace.auditChannel.listen(
      secondEpoch,
      (event) => received.push(event.call_id),
      (error) => {
        throw error;
      },
    );
    await appendFile(
      auditPath,
      [
        JSON.stringify({
          version: 1,
          runtime_id: runtimeId,
          turn_epoch: firstEpoch,
          call_id: "stale",
          tool_name: "query_sleep",
          phase: "start",
          at_ms: 2,
          input: {},
        }),
        JSON.stringify({
          version: 1,
          runtime_id: runtimeId,
          turn_epoch: secondEpoch,
          call_id: "second",
          tool_name: "query_sleep",
          phase: "start",
          at_ms: 3,
          input: {},
        }),
      ].join("\n") + "\n",
    );
    await second.drainAndStop();

    expect(received).toEqual(["first", "second"]);
  });
});
