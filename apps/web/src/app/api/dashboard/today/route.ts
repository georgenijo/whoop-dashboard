import { requireAuth } from "@/lib/auth";
import {
  buildDashboardToday,
  INVALID_DATE_MESSAGE,
  resolveRequestedDate,
} from "@/lib/dashboard/today";

export const dynamic = "force-dynamic";

// Live handler. The same logic is also served by the default-off Hono mount
// (`lib/api/app.ts`, #233); this file stays the production path until cutover.
export async function GET(req: Request) {
  try {
    const { user } = await requireAuth(req);
    const date = resolveRequestedDate(new URL(req.url).searchParams.get("date"));
    if (!date) {
      return Response.json({ error: INVALID_DATE_MESSAGE }, { status: 400 });
    }
    return Response.json(buildDashboardToday(user.id, date));
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
