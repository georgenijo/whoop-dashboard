import { createChatThread, getChatThreads } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { user } = await requireAuth(req);
    return Response.json(getChatThreads(user.id));
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuth(req);
    const thread = createChatThread(user.id);
    if (!thread) {
      return new Response("Error: thread creation failed", { status: 500 });
    }
    return Response.json({ id: thread.id });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
