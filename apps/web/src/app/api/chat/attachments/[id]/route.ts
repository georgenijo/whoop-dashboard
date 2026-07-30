import { requireAuth } from "@/lib/auth";
import { getChatAttachmentForUser } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requireAuth(req);
    const { id } = await ctx.params;
    const attachment = id ? getChatAttachmentForUser(user.id, id) : null;
    if (!attachment) {
      return new Response("Attachment not found", { status: 404 });
    }

    const etag = `"${attachment.sha256}"`;
    const headers = {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=31536000, immutable",
      "ETag": etag,
      "X-Content-Type-Options": "nosniff",
    };
    if (req.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(new Uint8Array(attachment.bytes), { headers });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
