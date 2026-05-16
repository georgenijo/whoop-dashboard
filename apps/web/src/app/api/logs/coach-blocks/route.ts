import { requireAuth } from "@/lib/auth";
import { getThreadBlocks } from "@/lib/db/coach-blocks";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let auth;
  try {
    auth = await requireAuth(req);
  } catch (err) {
    if (err instanceof Response) return err;
    return new Response("Unauthorized", { status: 401 });
  }
  const url = new URL(req.url);
  const raw = url.searchParams.get("thread_id");
  const threadId = raw ? Number(raw) : NaN;
  if (!Number.isInteger(threadId) || threadId <= 0) {
    return Response.json({ ok: false, error: "bad_thread_id" }, { status: 400 });
  }
  const blocks = getThreadBlocks(threadId, auth.user.id);
  return Response.json({ blocks });
}
