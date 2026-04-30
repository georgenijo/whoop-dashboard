import { clearChatMessages, getChatThreadById, getChatThreadMessages } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

function parseThreadId(value: string | null): number {
  const parsed = value == null ? NaN : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export async function GET(req: Request) {
  try {
    const user = await requireAuth(req);
    const threadId = parseThreadId(new URL(req.url).searchParams.get("thread_id"));
    return Response.json(getChatThreadMessages(user.id, threadId));
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireAuth(req);
    const threadId = parseThreadId(new URL(req.url).searchParams.get("thread_id"));
    const thread = getChatThreadById(user.id, threadId);
    if (!thread) {
      return new Response("Thread not found", { status: 404 });
    }
    clearChatMessages(threadId);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
