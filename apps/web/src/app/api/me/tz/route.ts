import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { setTzIfUnset } from "@/lib/db";

export const dynamic = "force-dynamic";

const TZ_MAX_LENGTH = 100;

// Mirrors the validator in /api/auth/apple/route.ts. Inlined here on purpose
// — the Phase E.1 plan explicitly defers a shared `sanitizeTimezone` util.
function sanitizeTimezone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > TZ_MAX_LENGTH) return null;
  try {
    // resolvedOptions().timeZone normalises case + offset aliases so we store
    // a single canonical IANA name regardless of browser quirks.
    return new Intl.DateTimeFormat("en-US", { timeZone: trimmed })
      .resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

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
