import "server-only";

import type { McpServer } from "@agentclientprotocol/sdk";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { dbPath } from "@/lib/db/connection";
import type { CoachImage } from "./image-types";
import {
  CURSOR_APP_ROOT,
  prepareCursorShimBin,
  removeCursorProjectRegistration,
  resolveMcpServerArgs,
  shimBinDirFor,
} from "./cursor-loop";
import { CursorMcpAuditChannel } from "./cursor-mcp-audit";

export type CursorAcpWorkspace = {
  root: string;
  shimBin: string;
  mcpServer: McpServer | null;
  auditChannel: CursorMcpAuditChannel;
  prepareTurn: (images: CoachImage[]) => Promise<string>;
  dispose: () => Promise<void>;
};

async function atomicWrite(filePath: string, value: string): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, filePath);
}

export async function createCursorAcpWorkspace(
  userId: number,
  withMcp: boolean,
): Promise<CursorAcpWorkspace> {
  const root = await mkdtemp(path.join(tmpdir(), "coach-cursor-acp-"));
  try {
    const dotCursor = path.join(root, ".cursor");
    const attachmentDir = path.join(root, "attachments");
    const manifestPath = path.join(root, "attachment-manifest.json");
    const epochPath = path.join(root, ".coach-turn-epoch");
    const auditPath = path.join(root, ".coach-mcp-audit.ndjson");
    const auditRuntimeId = randomUUID();
    await mkdir(dotCursor, { recursive: true, mode: 0o700 });
    await mkdir(attachmentDir, { recursive: true, mode: 0o700 });
    const shimBin = await prepareCursorShimBin(root, process.env.PATH);
    await writeFile(
      path.join(dotCursor, "cli.json"),
      JSON.stringify({
        permissions: {
          allow: ["Mcp(whoop:*)"],
          deny: ["Shell(*)", "Write(**)", "WebFetch(*)", "Read(**)"],
        },
      }),
      { mode: 0o600 },
    );
    await atomicWrite(manifestPath, "{}");
    await atomicWrite(auditPath, "");
    await atomicWrite(epochPath, randomUUID());

    const prepareTurn = async (images: CoachImage[]): Promise<string> => {
      await rm(attachmentDir, { recursive: true, force: true });
      await mkdir(attachmentDir, { recursive: true, mode: 0o700 });
      const manifest: Record<string, string> = {};
      for (const image of images) {
        const imagePath = path.join(attachmentDir, `${image.id}.jpg`);
        await writeFile(imagePath, image.bytes, { mode: 0o600 });
        manifest[image.id] = imagePath;
      }
      const epoch = randomUUID();
      await atomicWrite(manifestPath, JSON.stringify(manifest));
      await atomicWrite(auditPath, "");
      await atomicWrite(epochPath, epoch);
      return epoch;
    };

    let mcpServer: McpServer | null = null;
    if (withMcp) {
      const env = {
        PATH: process.env.PATH ?? "",
        COACH_MCP_USER_ID: String(userId),
        COACH_MCP_ATTACHMENT_MANIFEST: manifestPath,
        COACH_MCP_TURN_EPOCH_PATH: epochPath,
        COACH_MCP_AUDIT_PATH: auditPath,
        COACH_MCP_AUDIT_RUNTIME_ID: auditRuntimeId,
        WHOOP_DB_PATH: dbPath(),
        NODE_PATH: path.join(CURSOR_APP_ROOT, "node_modules"),
        TSX_TSCONFIG_PATH: path.join(CURSOR_APP_ROOT, "tsconfig.json"),
      };
      mcpServer = {
        name: "whoop",
        command: process.execPath,
        args: resolveMcpServerArgs(true),
        env: Object.entries(env).map(([name, value]) => ({ name, value })),
      };
    }

    return {
      root,
      shimBin,
      mcpServer,
      auditChannel: new CursorMcpAuditChannel(auditPath, auditRuntimeId),
      prepareTurn,
      dispose: async () => {
        try {
          await removeCursorProjectRegistration(root);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export function cursorAcpShimBin(workspace: string): string {
  return shimBinDirFor(workspace);
}
