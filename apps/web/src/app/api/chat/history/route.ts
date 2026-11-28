import {
  clearChatMessages,
  getChatThreadById,
  getChatThreadContext,
  getChatThreadMessages,
} from "@/lib/db";
import { requireAuth } from "@/lib/auth";

function parseThreadId(value: string | null): number {
  const parsed = value == null ? NaN : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuth(req);
    const params = new URL(req.url).searchParams;
    const threadId = parseThreadId(params.get("thread_id"));
    const messages = getChatThreadMessages(user.id, threadId);
    // Issue #608 — `include=context` opts into an object body carrying the
    // thread's context-window figure. The bare array stays the default so
    // existing callers are unaffected. Both reads are owner-scoped.
    if (params.get("include") === "context") {
      return Response.json({ messages, context: getChatThreadContext(user.id, threadId) });
    }
    return Response.json(messages);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

export async function DELETE(req: Request) {
  try {
    const { user } = await requireAuth(req);
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
