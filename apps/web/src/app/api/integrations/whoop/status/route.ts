import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getIntegration } from "@/lib/db/integrations";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { user } = await requireAuth(req);
  const integration = getIntegration(user.id, "whoop");
  return NextResponse.json({
    needs_reauth: integration?.needs_reauth === true,
  });
}
