import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { setTzIfUnset } from "@/lib/db";
import { sanitizeTimezone } from "@/lib/tz";

export const dynamic = "force-dynamic";

/**
 * Write-once IANA timezone capture for the current user. Called from the
 * welcome wizard (fire-and-forget) and from `<TzBackfill />` on the overview
 * page so existing users get backfilled on next page load. The "write-once"
 * gate lives in `setTzIfUnset` — repeated calls return `written: false`
 * without overwriting a previously-stored value.
 */
export async function POST(req: Request) {
  const { user } = await requireAuth(req);
  let body: { tz?: unknown };
  try {
    body = (await req.json()) as { tz?: unknown };
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const tz = sanitizeTimezone(body.tz);
  if (!tz) return NextResponse.json({ ok: false }, { status: 400 });
  const written = setTzIfUnset(user.id, tz);
  return NextResponse.json({ ok: true, written });
}
