import { NextResponse } from "next/server";
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { requireAuth } from "@/lib/auth";
import { getUserSettings, upsertUserSettings } from "@/lib/db";
import { clearGenerationFailure } from "@/lib/db/ai-generation";
import { maskAnthropicKey } from "@/lib/coach/key-mask";

export const dynamic = "force-dynamic";

// BYOK Anthropic key management endpoint.
//
// - GET    → { present, masked } — never returns cleartext.
// - POST   → { key } body → probe via `client.models.list({ limit: 1 })`
//            → on success, persist (encrypted in user_settings.anthropic_key)
//            → on 401, do NOT persist; return { ok:false, code:"invalid_key" }
//            → on other errors, do NOT persist; return { ok:false, code:"probe_failed" }
//            Malformed body → 400 invalid_request.
// - DELETE → clears the column (BYOK opt-out → fall back to env key).
//
// The probe-before-persist pattern keeps the DB free of unusable keys so a
// 401 in the Coach loop later means "Anthropic just rejected a previously-
// valid key" (rotation/revoke), not "we wrote garbage on save".

function maskedFor(userId: number) {
  const settings = getUserSettings(userId);
  if (settings?.anthropic_key) {
    return {
      present: true,
      masked: maskAnthropicKey(settings.anthropic_key),
      ...keySource(true),
    };
  }
  return { present: false, masked: null, ...keySource(false) };
}

function keySource(personal: boolean) {
  const fallback = Boolean(process.env.ANTHROPIC_API_KEY);
  return { fallback_available: fallback, source: personal ? "user" : fallback ? "env" : "none" };
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

  if (!body || typeof body.key !== "string") {
    return NextResponse.json(
      { ok: false, code: "invalid_request" },
      { status: 400 },
    );
  }
  const trimmed = body.key.trim();
  if (!trimmed.startsWith("sk-ant-") || trimmed.length < 20) {
    return NextResponse.json(
      { ok: false, code: "invalid_request" },
      { status: 400 },
    );
  }

  // Probe before persist. NEVER log `trimmed` (the raw key).
  const client = new Anthropic({ apiKey: trimmed, timeout: 15_000, maxRetries: 0 });
  try {
    await client.models.list({ limit: 1 });
  } catch (err) {
    if (err instanceof APIError && (err.status === 401 || err.status === 403)) {
      return NextResponse.json({ ok: false, code: "invalid_key" });
    }
    console.warn("[byok] probe_failed", {
      user_id: user.id,
      status: err instanceof APIError ? err.status : null,
    });
    return NextResponse.json({ ok: false, code: "probe_failed" });
  }

  upsertUserSettings({ user_id: user.id, anthropic_key: trimmed });
  clearGenerationFailure(user.id, "insight");
  clearGenerationFailure(user.id, "title");
  return NextResponse.json({
    ok: true,
    present: true,
    masked: maskAnthropicKey(trimmed),
    ...keySource(true),
  });
}

export async function DELETE(req: Request) {
  const { user } = await requireAuth(req);
  upsertUserSettings({ user_id: user.id, anthropic_key: null });
  clearGenerationFailure(user.id, "insight");
  clearGenerationFailure(user.id, "title");
  return NextResponse.json({ ok: true, present: false, masked: null, ...keySource(false) });
}
