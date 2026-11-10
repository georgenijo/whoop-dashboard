import { requireAuth } from "@/lib/auth";
import { getGenerationFailure } from "@/lib/db/ai-generation";
import { getInsightStatus } from "@/lib/insights";

export const dynamic = "force-dynamic";

// Observation only: polling never schedules generation or spends provider credits.
export async function GET(req: Request) {
  try {
    const { user } = await requireAuth(req);
    const status = getInsightStatus(user.id, true);
    const titleFailure = getGenerationFailure(user.id, "title");
    return Response.json({
      ready: status.insight !== null && !status.isStale,
      isRegenerating: status.isRegenerating,
      errorClass: status.errorClass,
      nextRetryAt: status.nextRetryAt,
      titleErrorClass: titleFailure?.error_class ?? null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
