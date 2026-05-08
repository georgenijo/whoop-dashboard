import { deleteChatThread, getChatThreadById, getChatThreadMessages } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireAuth(req);
    const { id } = await ctx.params;
    const threadId = parseId(id);
    if (threadId == null) {
      return new Response("Invalid thread id", { status: 400 });
    }
    const thread = getChatThreadById(user.id, threadId);
    if (!thread) {
      return new Response("Thread not found", { status: 404 });
    }
    return Response.json({
      thread,
      messages: getChatThreadMessages(user.id, threadId),
    });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireAuth(req);
    const { id } = await ctx.params;
    const threadId = parseId(id);
    if (threadId == null) {
      return new Response("Invalid thread id", { status: 400 });
    }
    const ok = deleteChatThread(threadId, user.id);
    if (!ok) {
      return new Response("Thread not found", { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
