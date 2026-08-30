// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import { parseCoachMcpAuditEvent } from "./audit-events";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe("compiled Coach MCP server", () => {
  it("emits exact bounded audit events without exposing image bytes", async () => {
    const dir = await mkdtemp(path.join(process.cwd(), ".coach-mcp-server-"));
    dirs.push(dir);
    const outputPath = path.join(dir, "server.mjs");
    const epochPath = path.join(dir, "epoch");
    const auditPath = path.join(dir, "audit.ndjson");
    const manifestPath = path.join(dir, "manifest.json");
    const dbFile = path.join(dir, "test.db");
    const attachmentId = "11111111-1111-4111-8111-111111111111";
    const attachmentDir = path.join(dir, "attachments");
    const attachmentPath = path.join(attachmentDir, `${attachmentId}.jpg`);
    await mkdir(attachmentDir);
    await Promise.all([
      writeFile(epochPath, "turn-1"),
      writeFile(auditPath, ""),
      writeFile(manifestPath, JSON.stringify({ [attachmentId]: attachmentPath })),
      writeFile(attachmentPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    ]);
    await build({
      entryPoints: [path.resolve("src/coach-mcp/server.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      tsconfig: path.resolve("tsconfig.json"),
      outfile: outputPath,
      logLevel: "silent",
    });

    const child = spawn(
      process.execPath,
      ["--conditions=react-server", outputPath],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          COACH_MCP_USER_ID: "7",
          COACH_MCP_ATTACHMENT_MANIFEST: manifestPath,
          COACH_MCP_TURN_EPOCH_PATH: epochPath,
          COACH_MCP_AUDIT_PATH: auditPath,
          COACH_MCP_AUDIT_RUNTIME_ID: "runtime-1",
          WHOOP_DB_PATH: dbFile,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
    const response = new Promise<Record<string, unknown>>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        reject(new Error(`MCP response timed out: ${stderr}`));
      }, 5_000);
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        const lines = stdout.split("\n");
        stdout = lines.pop() ?? "";
        for (const line of lines) {
          const message = JSON.parse(line) as Record<string, unknown>;
          if (message.id === 1) {
            clearTimeout(timer);
            resolve(message);
          }
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        if (code && code !== 0) {
          clearTimeout(timer);
          reject(new Error(`MCP server exited ${code}: ${stderr}`));
        }
      });
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "view_chat_image",
          arguments: { attachment_id: attachmentId },
        },
      })}\n`,
    );

    const message = await response;
    child.stdin.end();
    await exited;
    expect(message).toMatchObject({
      id: 1,
      result: { isError: false },
    });
    const events = (await readFile(auditPath, "utf8"))
      .trim()
      .split("\n")
      .map(parseCoachMcpAuditEvent);
    expect(events).toHaveLength(2);
    expect(events).toEqual([
      expect.objectContaining({
        phase: "start",
        tool_name: "view_chat_image",
        turn_epoch: "turn-1",
      }),
      expect.objectContaining({
        phase: "end",
        tool_name: "view_chat_image",
        status: "ok",
        response: { reviewed: true, mime_type: "image/jpeg" },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("base64");
  });
});
