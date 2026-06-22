import { requireAuth } from "@/lib/auth";
import { getWorkoutPlans } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/plans — { plans: WorkoutPlan[] }, active first then updated_at desc.
// Serves BOTH web and iOS; requireAuth resolves Bearer (iOS) -> Cookie (web) ->
// 401. See docs/plans-contract.md for the response shape.
export async function GET(req: Request) {
  try {
    const { user } = await requireAuth(req);
    return Response.json({ plans: getWorkoutPlans(user.id) });
  } catch (err) {
    // requireAuth throws a Response (401) — rethrow it as the HTTP response.
    if (err instanceof Response) return err;
    throw err;
  }
}
