import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { setCoachGoals } from "@/lib/db";
import { COACH_GOAL_SET } from "@/lib/coach/goals";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { user } = await requireAuth(req);
  let body: { goals?: unknown };
  try {
    body = (await req.json()) as { goals?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (!Array.isArray(body.goals)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const filtered: string[] = [];
  const seen = new Set<string>();
  for (const g of body.goals) {
    // Canonical-set filter — typos and stale enum values are silently dropped
    // (the response echoes back the accepted list, no 400).
    if (typeof g === "string" && COACH_GOAL_SET.has(g) && !seen.has(g)) {
      seen.add(g);
      filtered.push(g);
    }
  }
  setCoachGoals(user.id, filtered);
  return NextResponse.json({ ok: true, goals: filtered });
}
