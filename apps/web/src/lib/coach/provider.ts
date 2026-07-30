import "server-only";
// Coach provider selection. The coach can run on Anthropic (default) or Cursor
// Composer. Both providers support per-user BYOK with a shared env fallback.
// Selection is stored
// in `user_settings.model_pref` as a "<provider>:<model>" string — no DB
// migration, reuses the existing column. Unknown / NULL prefs fall back to the
// Anthropic default, so legacy values and unset users keep working unchanged.
import { getUserSettings } from "@/lib/db";

export type CoachProvider = "anthropic" | "cursor";
export type CoachModelSelection = { provider: CoachProvider; model: string };

// Default chat model — must match the Anthropic loop's model constant.
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
export const CURSOR_COMPOSER_MODEL = "composer-2.5-fast";

export const ANTHROPIC_PREF = `anthropic:${DEFAULT_ANTHROPIC_MODEL}`;
export const CURSOR_PREF = `cursor:${CURSOR_COMPOSER_MODEL}`;

const KNOWN: Record<string, CoachModelSelection> = {
  [ANTHROPIC_PREF]: { provider: "anthropic", model: DEFAULT_ANTHROPIC_MODEL },
  [CURSOR_PREF]: { provider: "cursor", model: CURSOR_COMPOSER_MODEL },
};

const ANTHROPIC_DEFAULT: CoachModelSelection = {
  provider: "anthropic",
  model: DEFAULT_ANTHROPIC_MODEL,
};

/** Parse a stored model_pref into a provider+model, defaulting to Anthropic. */
export function parseModelPref(
  pref: string | null | undefined,
): CoachModelSelection {
  if (pref && KNOWN[pref]) return KNOWN[pref];
  if (pref?.startsWith("cursor:")) {
    const model = pref.slice("cursor:".length).trim();
    if (model && model.length <= 200 && !/[\s\x00-\x1f]/.test(model)) {
      return { provider: "cursor", model };
    }
  }
  return ANTHROPIC_DEFAULT;
}

export function cursorModelFromPref(pref: string): string | null {
  if (!pref.startsWith("cursor:")) return null;
  const parsed = parseModelPref(pref);
  return parsed.provider === "cursor" ? parsed.model : null;
}

export function modelPrefForSelection(
  selection: CoachModelSelection,
): string {
  return `${selection.provider}:${selection.model}`;
}

/** Whether Cursor has either a personal key or the shared server fallback. */
export function cursorProviderEnabled(userId: number): boolean {
  return Boolean(
    getUserSettings(userId)?.cursor_key || process.env.CURSOR_API_KEY,
  );
}

/**
 * Resolve the provider for a coach turn. If a user selected Cursor but the
 * shared key is unset (e.g. removed from env), fall back to Anthropic rather
 * than failing the turn.
 */
export function resolveCoachProvider(userId: number): CoachModelSelection {
  const selection = parseModelPref(getUserSettings(userId)?.model_pref);
  if (selection.provider === "cursor" && !cursorProviderEnabled(userId)) {
    return ANTHROPIC_DEFAULT;
  }
  return selection;
}
