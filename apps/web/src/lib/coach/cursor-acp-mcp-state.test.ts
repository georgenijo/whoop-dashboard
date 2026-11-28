// @vitest-environment node
//
// Persistent-session MCP contracts (issue #552). Cursor keeps one Coach MCP
// process alive for a whole ACP session, so per-turn state must be reset by
// the parent-owned epoch file and per-turn attachment scope by the manifest —
// without any user, thread, or path crossing between workspaces.
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/connection", () => ({ dbPath: () => "/tmp/whoop-test.db" }));
vi.mock("./cursor-loop", () => ({
  CURSOR_APP_ROOT: "/tmp/coach-app",
  prepareCursorShimBin: async (root: string) => path.join(root, "shim"),
  removeCursorProjectRegistration: async () => {},
  resolveMcpServerArgs: () => ["--conditions=react-server", "server.mjs"],
}));

import { viewChatImage } from "@/coach-mcp/chat-image-tool";
import { CoachMcpTurnState } from "@/coach-mcp/turn-state";
import {
  createCursorAcpWorkspace,
  type CursorAcpWorkspace,
} from "./cursor-acp-workspace";
import type { CoachImage } from "./image-types";

const workspaces: CursorAcpWorkspace[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => workspace.dispose()));
});

async function workspaceFor(userId: number) {
  const workspace = await createCursorAcpWorkspace(userId, true);
  workspaces.push(workspace);
  const server = workspace.mcpServer;
  if (!server || !("env" in server)) throw new Error("expected stdio MCP server");
  const env = Object.fromEntries(
    server.env.map(({ name, value }) => [name, value]),
  );
  return { workspace, env };
}

function image(label: string): CoachImage {
  const bytes = Buffer.from(`jpeg-${label}`);
  return {
    id: randomUUID(),
    mimeType: "image/jpeg",
    width: 1,
    height: 1,
    bytes,
    sha256: label,
  };
}

describe("persistent Cursor ACP MCP state", () => {
  it("resets MCP turn guards on every prepared turn of one persistent session", async () => {
    const { workspace, env } = await workspaceFor(7);
    // One long-lived MCP process == one CoachMcpTurnState for the session.
    const mcpState = new CoachMcpTurnState(env.COACH_MCP_TURN_EPOCH_PATH);

    const firstEpoch = await workspace.prepareTurn([]);
    const first = await mcpState.currentContext();
    expect(first.epoch).toBe(firstEpoch);
    first.state.syncAttempts = 1;
    first.state.savedPlanHashes.set("plan", 1);
    // Repeated tool calls inside the same turn see the same guards.
    expect((await mcpState.currentContext()).state).toBe(first.state);

    const secondEpoch = await workspace.prepareTurn([]);
    const second = await mcpState.currentContext();
    expect(secondEpoch).not.toBe(firstEpoch);
    expect(second.epoch).toBe(secondEpoch);
    expect(second.state).not.toBe(first.state);
    expect(second.state.syncAttempts).toBe(0);
    expect(second.state.savedPlanHashes.size).toBe(0);
  });

  it("rotates the attachment manifest so a previous turn's image is unreachable", async () => {
    const { workspace, env } = await workspaceFor(7);
    const manifestPath = env.COACH_MCP_ATTACHMENT_MANIFEST;
    const photo = image("first");

    await workspace.prepareTurn([photo]);
    await expect(
      viewChatImage({ attachment_id: photo.id }, manifestPath),
    ).resolves.toEqual({
      data: photo.bytes.toString("base64"),
      mimeType: "image/jpeg",
    });
    const firstPath = JSON.parse(await readFile(manifestPath, "utf8"))[
      photo.id
    ] as string;

    await workspace.prepareTurn([]);
    expect(JSON.parse(await readFile(manifestPath, "utf8"))).toEqual({});
    await expect(access(firstPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      viewChatImage({ attachment_id: photo.id }, manifestPath),
    ).rejects.toThrow("not available in this turn");
  });

  it("keeps user identity, paths, epochs, and attachments separate per workspace", async () => {
    const seven = await workspaceFor(7);
    const eight = await workspaceFor(8);
    expect(seven.env.COACH_MCP_USER_ID).toBe("7");
    expect(eight.env.COACH_MCP_USER_ID).toBe("8");
    expect(seven.env.COACH_MCP_AUDIT_RUNTIME_ID).not.toBe(
      eight.env.COACH_MCP_AUDIT_RUNTIME_ID,
    );
    for (const { workspace, env } of [seven, eight]) {
      for (const name of [
        "COACH_MCP_ATTACHMENT_MANIFEST",
        "COACH_MCP_TURN_EPOCH_PATH",
        "COACH_MCP_AUDIT_PATH",
      ]) {
        expect(env[name].startsWith(`${workspace.root}${path.sep}`)).toBe(true);
      }
    }
    expect(seven.workspace.root).not.toBe(eight.workspace.root);

    const sevenState = new CoachMcpTurnState(seven.env.COACH_MCP_TURN_EPOCH_PATH);
    await seven.workspace.prepareTurn([]);
    const sevenTurn = await sevenState.current();
    sevenTurn.syncAttempts = 1;
    // Another user's turn boundary never resets this user's in-flight guards.
    await eight.workspace.prepareTurn([]);
    expect(await sevenState.current()).toBe(sevenTurn);

    const photo = image("seven-only");
    await seven.workspace.prepareTurn([photo]);
    await expect(
      viewChatImage(
        { attachment_id: photo.id },
        eight.env.COACH_MCP_ATTACHMENT_MANIFEST,
      ),
    ).rejects.toThrow("not available in this turn");
  });

  it("removes the whole temporary tree on dispose", async () => {
    const workspace = await createCursorAcpWorkspace(7, true);
    await workspace.prepareTurn([image("cleanup")]);
    await workspace.dispose();
    await expect(access(workspace.root)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
