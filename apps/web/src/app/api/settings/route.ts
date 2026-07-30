import { getSetting, setSetting, getUserSettings, upsertUserSettings } from "@/lib/db";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/coach/prompts";
import { requireAuth } from "@/lib/auth";
import {
  CursorModelCatalogError,
  listCursorModelsForKey,
} from "@/lib/coach/cursor-models";
import { resolveCursorKey } from "@/lib/coach/cursor-key";
import {
  ANTHROPIC_PREF,
  cursorModelFromPref,
  cursorProviderEnabled,
  modelPrefForSelection,
  parseModelPref,
} from "@/lib/coach/provider";

// `system_prompt` is a global app_setting (shared); `model_pref` is per-user.
function settingsPayload(userId: number) {
  const settings = getUserSettings(userId);
  const selection = parseModelPref(settings?.model_pref);
  const cursorAvailable = Boolean(
    settings?.cursor_key || process.env.CURSOR_API_KEY,
  );
  return {
    system_prompt: getSetting("system_prompt") || DEFAULT_SYSTEM_PROMPT,
    default_system_prompt: DEFAULT_SYSTEM_PROMPT,
    model_pref:
      selection.provider === "cursor" && cursorAvailable
        ? modelPrefForSelection(selection)
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
      if (body.model_pref === ANTHROPIC_PREF) {
        upsertUserSettings({ user_id: user.id, model_pref: body.model_pref });
      } else {
        const cursorModel = cursorModelFromPref(body.model_pref);
        if (!cursorModel) {
          return Response.json(
            { error: "invalid model_pref" },
            { status: 400 },
          );
        }
        if (!cursorProviderEnabled(user.id)) {
          return Response.json(
            { error: "Cursor provider is not available for this user" },
            { status: 400 },
          );
        }

        try {
          const { key } = resolveCursorKey(user.id);
          const models = await listCursorModelsForKey(key);
          if (!models.some((model) => model.id === cursorModel)) {
            return Response.json(
              { error: "Cursor model is not available for this account" },
              { status: 400 },
            );
          }
        } catch (error) {
          if (error instanceof CursorModelCatalogError) {
            if (error.reason === "invalid_key") {
              return Response.json(
                { error: "Cursor rejected the configured API key" },
                { status: 422 },
              );
            }
            return Response.json(
              { error: "Cursor model catalog is unavailable" },
              { status: 502 },
            );
          }
          throw error;
        }

        upsertUserSettings({
          user_id: user.id,
          model_pref: `cursor:${cursorModel}`,
        });
      }
    }

    return Response.json(settingsPayload(user.id));
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
