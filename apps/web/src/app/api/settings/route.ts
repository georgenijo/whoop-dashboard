import { getSetting, setSetting, getUserSettings, upsertUserSettings } from "@/lib/db";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/coach/prompts";
import { requireAuth } from "@/lib/auth";
import {
  ALLOWED_MODEL_PREFS,
  ANTHROPIC_PREF,
  CURSOR_PREF,
  cursorProviderEnabled,
  parseModelPref,
  type AllowedModelPref,
} from "@/lib/coach/provider";

// `system_prompt` is a global app_setting (shared); `model_pref` is per-user.
function settingsPayload(userId: number) {
  const selection = parseModelPref(getUserSettings(userId)?.model_pref);
  const cursorAvailable = cursorProviderEnabled(userId);
  return {
    system_prompt: getSetting("system_prompt") || DEFAULT_SYSTEM_PROMPT,
    default_system_prompt: DEFAULT_SYSTEM_PROMPT,
    model_pref:
      selection.provider === "cursor" && cursorAvailable
        ? CURSOR_PREF
        : ANTHROPIC_PREF,
    cursor_available: cursorAvailable,
  };
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuth(req);
    return Response.json(settingsPayload(user.id));
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuth(req);

    const body = (await req.json()) as {
      system_prompt?: string;
      model_pref?: string;
    };

    if (typeof body.system_prompt === "string") {
      setSetting("system_prompt", body.system_prompt);
    }

    if (typeof body.model_pref === "string") {
      if (!ALLOWED_MODEL_PREFS.includes(body.model_pref as AllowedModelPref)) {
        return Response.json({ error: "invalid model_pref" }, { status: 400 });
      }
      if (body.model_pref === CURSOR_PREF && !cursorProviderEnabled(user.id)) {
        return Response.json(
          { error: "Cursor provider is not available on this server" },
          { status: 400 },
        );
      }
      upsertUserSettings({ user_id: user.id, model_pref: body.model_pref });
    }

    return Response.json(settingsPayload(user.id));
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
