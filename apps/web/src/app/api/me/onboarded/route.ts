import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { markOnboarded } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Set-once "user has seen the welcome wizard" stamp. Called from Screen 2's
 * "I'll do this later" path and from the sync screen's finally block. Repeated
 * calls return the existing stamp without overwriting it (see `markOnboarded`).
 */
export async function POST(req: Request) {
  const { user } = await requireAuth(req);
  const stampedAt = markOnboarded(user.id);
  return NextResponse.json({ ok: true, onboarded_at: stampedAt });
}
