import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

export async function viewChatImage(
  argumentsValue: unknown,
  manifestPath: string,
): Promise<{
  data: string;
  mimeType: "image/jpeg";
}> {
  const attachmentId =
    argumentsValue &&
    typeof argumentsValue === "object" &&
    typeof (argumentsValue as { attachment_id?: unknown }).attachment_id === "string"
      ? (argumentsValue as { attachment_id: string }).attachment_id
      : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      attachmentId,
    )
  ) {
    throw new Error("attachment_id is invalid");
  }
  if (!manifestPath) throw new Error("attachment manifest unavailable");

  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as Record<string, unknown>;
  const configuredPath = manifest[attachmentId];
  if (typeof configuredPath !== "string") {
    throw new Error("attachment is not available in this turn");
  }
  const manifestRoot = path.join(path.dirname(manifestPath), "attachments");
  const [root, imagePath] = await Promise.all([
    realpath(manifestRoot),
    realpath(configuredPath),
  ]);
  if (!imagePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("attachment path escaped the private turn directory");
  }
  const bytes = await readFile(imagePath);
  return { data: bytes.toString("base64"), mimeType: "image/jpeg" };
}
