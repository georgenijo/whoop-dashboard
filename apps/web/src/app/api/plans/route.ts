import { requireAuth } from "@/lib/auth";
import { getWorkoutPlans } from "@/lib/db";
import { getPlansRecovery } from "@/lib/plans/recovery";

export const dynamic = "force-dynamic";

// GET /api/plans — { plans: WorkoutPlan[], recovery: { today, week } }.
// Plans: active first then updated_at desc. recovery: today's banded recovery +
// the last-7-days strip, from the SAME shared helper the /plans page uses, so
// web and the iOS Plans tab can't drift. Serves BOTH web and iOS; requireAuth
// resolves Bearer (iOS) -> Cookie (web) -> 401. See docs/plans-contract.md.
export async function GET(req: Request) {
  try {
    const { user } = await requireAuth(req);
    return Response.json({
      plans: getWorkoutPlans(user.id),
      recovery: getPlansRecovery(user.id),
    });
  } catch (err) {
    // requireAuth throws a Response (401) — rethrow it as the HTTP response.
    if (err instanceof Response) return err;
    throw err;
  }
}
