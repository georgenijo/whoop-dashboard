import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getUserSettings, upsertUserSettings } from "@/lib/db";
import { maskCursorKey } from "@/lib/coach/key-mask";
import { probeCursorKey } from "@/lib/coach/cursor-key";

export const dynamic = "force-dynamic";

type CursorKeyState = {
  present: boolean;
  masked: string | null;
  fallback_available: boolean;
};

function maskedFor(userId: number): CursorKeyState {
  const settings = getUserSettings(userId);
  if (settings?.cursor_key) {
    return {
      present: true,
      masked: maskCursorKey(settings.cursor_key),
      fallback_available: Boolean(process.env.CURSOR_API_KEY),
    };
  }
  return {
    present: false,
    masked: null,
    fallback_available: Boolean(process.env.CURSOR_API_KEY),
  };
}

export async function GET(req: Request) {
  const { user } = await requireAuth(req);
  return NextResponse.json(maskedFor(user.id));
}

export async function POST(req: Request) {
  const { user } = await requireAuth(req);

  let body: { key?: unknown };
  try {
    body = (await req.json()) as { key?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, code: "invalid_request" },
      { status: 400 },
    );
  }

  if (typeof body.key !== "string") {
    return NextResponse.json(
      { ok: false, code: "invalid_request" },
      { status: 400 },
    );
  }
  const trimmed = body.key.trim();
  // Cursor does not document a stable user-key prefix. Keep the local shape
  // check deliberately loose and let the authenticated CLI probe decide
  // whether the credential is valid.
  if (trimmed.length < 16 || /\s/.test(trimmed)) {
    return NextResponse.json(
      { ok: false, code: "invalid_request" },
      { status: 400 },
    );
  }

  const probe = await probeCursorKey(trimmed);
  if (probe === "invalid_key") {
    return NextResponse.json({ ok: false, code: "invalid_key" });
  }
  if (probe === "probe_failed") {
    console.warn("[cursor-byok] probe_failed", { user_id: user.id });
    return NextResponse.json({ ok: false, code: "probe_failed" });
  }

  upsertUserSettings({ user_id: user.id, cursor_key: trimmed });
  return NextResponse.json({
    ok: true,
    present: true,
    masked: maskCursorKey(trimmed),
    fallback_available: Boolean(process.env.CURSOR_API_KEY),
  });
}

export async function DELETE(req: Request) {
  const { user } = await requireAuth(req);
  upsertUserSettings({ user_id: user.id, cursor_key: null });
  return NextResponse.json(maskedFor(user.id));
}
