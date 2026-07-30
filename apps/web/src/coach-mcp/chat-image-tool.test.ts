// @vitest-environment node
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { viewChatImage } from "./chat-image-tool";

const allowedId = "10000000-0000-4000-8000-000000000001";
let workspace = "";
let manifestPath = "";
let bytes: Buffer;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "chat-image-tool-"));
  const attachmentDir = path.join(workspace, "attachments");
  await mkdir(attachmentDir, { mode: 0o700 });
  const imagePath = path.join(attachmentDir, `${allowedId}.jpg`);
  bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  await writeFile(imagePath, bytes);
  manifestPath = path.join(workspace, "attachment-manifest.json");
  await writeFile(manifestPath, JSON.stringify({ [allowedId]: imagePath }));
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("Cursor view_chat_image", () => {
  it("returns valid MCP image data for a manifest-scoped attachment", async () => {
    await expect(
      viewChatImage({ attachment_id: allowedId }, manifestPath),
    ).resolves.toEqual({
      data: bytes.toString("base64"),
      mimeType: "image/jpeg",
    });
  });

  it("rejects malformed, absent, and escaped attachment IDs", async () => {
    await expect(
      viewChatImage({ attachment_id: "../../secret" }, manifestPath),
    ).rejects.toThrow("attachment_id is invalid");
    await expect(
      viewChatImage(
        { attachment_id: "20000000-0000-4000-8000-000000000002" },
        manifestPath,
      ),
    ).rejects.toThrow("not available in this turn");

    const escapedId = "30000000-0000-4000-8000-000000000003";
    const escaped = path.join(workspace, "outside.jpg");
    await writeFile(escaped, bytes);
    await writeFile(
      manifestPath,
      JSON.stringify({ [escapedId]: escaped }),
    );
    await expect(
      viewChatImage({ attachment_id: escapedId }, manifestPath),
    ).rejects.toThrow("escaped the private turn directory");
  });
});
