import { getSetting, getUserSettings, upsertUserSettings } from "@/lib/db";
import {
  DEFAULT_SYSTEM_PROMPT,
  MAX_SYSTEM_PROMPT_LENGTH,
  resolveSystemPrompt,
} from "@/lib/coach/prompts";
import { requireAuth } from "@/lib/auth";
import {
  CursorModelCatalogError,
  listCursorModelsForKey,
} from "@/lib/coach/cursor-models";
import { resolveCursorKey } from "@/lib/coach/cursor-key";
import type { CursorModelParameterSelection } from "@/lib/coach/cursor-model-params";
import {
  ANTHROPIC_PREF,
  cursorModelFromPref,
  cursorProviderEnabled,
  isCoachEffort,
  modelPrefForSelection,
  parseCoachEffort,
  parseModelPref,
} from "@/lib/coach/provider";

// `system_prompt` is per-user (issue #493 — it used to be a single
// app-global app_setting that any authenticated user could overwrite for
// everyone). Resolution falls back to the legacy global value, then the
// built-in default — see resolveSystemPrompt.
function settingsPayload(userId: number) {
  const settings = getUserSettings(userId);
  const selection = parseModelPref(settings?.model_pref);
  const cursorAvailable = Boolean(
    settings?.cursor_key || process.env.CURSOR_API_KEY,
  );
  return {
    system_prompt: resolveSystemPrompt(
      settings?.system_prompt,
      getSetting("system_prompt"),
    ),
    default_system_prompt: DEFAULT_SYSTEM_PROMPT,
    model_pref:
      selection.provider === "cursor" && cursorAvailable
        ? modelPrefForSelection(selection)
        : ANTHROPIC_PREF,
    coach_effort: parseCoachEffort(settings?.coach_effort),
    cursor_model_params: settings?.cursor_model_params ?? {},
    cursor_available: cursorAvailable,
  };
}

type CursorModelParamsUpdate = {
  model_id: string;
  params: CursorModelParameterSelection[];
};

function parseCursorModelParamsUpdate(value: unknown): CursorModelParamsUpdate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { model_id: modelId, params } = value as {
    model_id?: unknown;
    params?: unknown;
  };
  if (
    typeof modelId !== "string" ||
    !modelId ||
    modelId.length > 200 ||
    /[\s\x00-\x1f\[\],=]/.test(modelId) ||
    !Array.isArray(params) ||
    params.length > 8
  ) {
    return null;
  }
  const seen = new Set<string>();
  const parsed: CursorModelParameterSelection[] = [];
  for (const param of params) {
    if (!param || typeof param !== "object" || Array.isArray(param)) return null;
    const { id, value: paramValue } = param as {
      id?: unknown;
      value?: unknown;
    };
    if (
      typeof id !== "string" ||
      typeof paramValue !== "string" ||
      !id ||
      !paramValue ||
      seen.has(id)
    ) {
      return null;
    }
    seen.add(id);
    parsed.push({ id, value: paramValue });
  }
  return { model_id: modelId, params: parsed };
}

function cursorCatalogErrorResponse(error: CursorModelCatalogError): Response {
  return error.reason === "invalid_key"
    ? Response.json(
        { error: "Cursor rejected the configured API key" },
        { status: 422 },
      )
    : Response.json(
        { error: "Cursor model catalog is unavailable" },
        { status: 502 },
      );
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
      coach_effort?: unknown;
      cursor_model_params?: unknown;
    };

    if (typeof body.system_prompt === "string") {
      if (body.system_prompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
        return Response.json(
          {
            error: `system_prompt must be ${MAX_SYSTEM_PROMPT_LENGTH} characters or fewer`,
          },
          { status: 400 },
        );
      }
      // Empty string clears the per-user override (falls back to the legacy
      // global value, then the default) rather than pinning an empty prompt.
      upsertUserSettings({
        user_id: user.id,
        system_prompt: body.system_prompt.length > 0 ? body.system_prompt : null,
      });
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
            return cursorCatalogErrorResponse(error);
          }
          throw error;
        }

        upsertUserSettings({
          user_id: user.id,
          model_pref: `cursor:${cursorModel}`,
        });
      }
    }

    if (body.coach_effort !== undefined) {
      if (!isCoachEffort(body.coach_effort)) {
        return Response.json(
          { error: "invalid coach_effort" },
          { status: 400 },
        );
      }
      upsertUserSettings({
        user_id: user.id,
        coach_effort: body.coach_effort,
      });
    }

    if (body.cursor_model_params !== undefined) {
      const update = parseCursorModelParamsUpdate(body.cursor_model_params);
      if (!update) {
        return Response.json(
          { error: "invalid cursor_model_params" },
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
        const model = models.find((candidate) => candidate.id === update.model_id);
        if (!model) {
          return Response.json(
            { error: "Cursor model is not available for this account" },
            { status: 400 },
          );
        }
        const valid = update.params.every((param) => {
          const definition = model.parameters.find(
            (candidate) => candidate.id === param.id,
          );
          return definition?.values.some((value) => value.value === param.value);
        });
        if (!valid) {
          return Response.json(
            { error: "Cursor model parameter is not available" },
            { status: 400 },
          );
        }
      } catch (error) {
        if (error instanceof CursorModelCatalogError) {
          return cursorCatalogErrorResponse(error);
        }
        throw error;
      }

      const settings = getUserSettings(user.id);
      upsertUserSettings({
        user_id: user.id,
        cursor_model_params: {
          ...(settings?.cursor_model_params ?? {}),
          [update.model_id]: update.params,
        },
      });
    }

    return Response.json(settingsPayload(user.id));
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
