import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getIntegration } from "@/lib/db/integrations";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // requireAuth still gates the route — no anonymous reads — but the lookup
  // itself is hard-coded to user_id=1 because the writers (refreshTokens,
  // saveTokens via DEFAULT_USER_ID) only ever touch row 1. iOS auth resolves
  // to user_id=2; without this mirror it would silently get needs_reauth=false
  // from a missing row regardless of actual token health. Revisit when
  // per-user Whoop tokens land.
  await requireAuth(req);
  const integration = getIntegration(1, "whoop");
  return NextResponse.json({
    needs_reauth: integration?.needs_reauth === true,
  });
}
