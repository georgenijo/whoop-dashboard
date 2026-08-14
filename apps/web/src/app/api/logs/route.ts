import { requireAuth } from "@/lib/auth";
import { getChatLogs, clearChatLogs } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { user } = await requireAuth(req);

    const adminSub = process.env.ADMIN_APPLE_SUB;
    if (!adminSub) {
      return new Response("ADMIN_APPLE_SUB not configured", { status: 500 });
    }
    if (user.apple_sub !== adminSub) {
      return new Response("Forbidden", { status: 403 });
    }

    return Response.json(getChatLogs(user.id, 500));
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

export async function DELETE(req: Request) {
  try {
    const { user } = await requireAuth(req);

    const adminSub = process.env.ADMIN_APPLE_SUB;
    if (!adminSub) {
      return new Response("ADMIN_APPLE_SUB not configured", { status: 500 });
    }
    if (user.apple_sub !== adminSub) {
      return new Response("Forbidden", { status: 403 });
    }

    clearChatLogs(user.id);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
