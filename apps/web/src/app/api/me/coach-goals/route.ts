import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { setCoachGoals } from "@/lib/db";

export const dynamic = "force-dynamic";

// Canonical goal identifiers. Anything not in this set is silently filtered
// out — the response echoes back the accepted list, so the client gets a
// quiet "did you mean…" signal without 400-ing on a typo or stale enum.
const CANONICAL_GOALS = new Set([
  "sleep_better",
  "recover_faster",
  "train_smarter",
  "manage_stress",
]);

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
    if (typeof g === "string" && CANONICAL_GOALS.has(g) && !seen.has(g)) {
      seen.add(g);
      filtered.push(g);
    }
  }
  setCoachGoals(user.id, filtered);
  return NextResponse.json({ ok: true, goals: filtered });
}
