import { requireAuth } from "@/lib/auth";
import { resolveApiKeyForUser, MissingApiKeyError } from "@/lib/coach/api-key";
import { getLatestWhoopDataTimestamp } from "@/lib/db";
import {
  getInsightStatus,
  insightUnavailableReason,
} from "@/lib/insights";

export const dynamic = "force-dynamic";

/**
 * Lightweight, authenticated poll target for the Overview AI insight card
 * (issue #588). The card's watcher hits this instead of calling
 * `router.refresh()` every 5 seconds, so a slow/failed generation no longer
 * re-renders the entire page or spends repeated model calls.
 *
 * Generation itself stays on the page render (schedule once via `after()`);
 * this route only reports terminal/backoff state. It never writes.
 */
export async function GET(req: Request) {
  try {
    const { user } = await requireAuth(req);

    let hasApiKey = true;
    try {
      resolveApiKeyForUser(user.id);
    } catch (err) {
      if (err instanceof MissingApiKeyError) {
        hasApiKey = false;
      } else {
        throw err;
      }
    }

    const hasData = getLatestWhoopDataTimestamp(user.id) !== null;
    const status = getInsightStatus(user.id, hasData);
    const reason = insightUnavailableReason(status, hasApiKey);

    return Response.json({
      ready: !status.isStale,
      stale: status.isStale,
      regenerating: status.isRegenerating,
      failed: status.isStale && !status.isRegenerating && reason !== null,
      reason,
      retry_at: status.retryAt,
      insight_date: status.insight?.date ?? null,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
