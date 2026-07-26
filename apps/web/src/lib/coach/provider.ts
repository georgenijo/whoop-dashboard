import "server-only";
// Coach provider selection. The coach can run on Anthropic (default, per-user
// BYOK) or Cursor Composer (opt-in, shared CURSOR_API_KEY). Selection is stored
// in `user_settings.model_pref` as a "<provider>:<model>" string — no DB
// migration, reuses the existing column. Unknown / NULL prefs fall back to the
// Anthropic default, so legacy values and unset users keep working unchanged.
import { getUserSettings } from "@/lib/db";

export type CoachProvider = "anthropic" | "cursor";
export type CoachModelSelection = { provider: CoachProvider; model: string };

// Default chat model — must match the Anthropic loop's model constant.
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
export const CURSOR_COMPOSER_MODEL = "composer-2.5-fast";
const LEGACY_CURSOR_COMPOSER_MODEL = "composer-2.5";

export const ANTHROPIC_PREF = `anthropic:${DEFAULT_ANTHROPIC_MODEL}`;
export const CURSOR_PREF = `cursor:${CURSOR_COMPOSER_MODEL}`;
const LEGACY_CURSOR_PREF = `cursor:${LEGACY_CURSOR_COMPOSER_MODEL}`;

// The set of model_pref values the settings UI is allowed to persist.
export const ALLOWED_MODEL_PREFS = [ANTHROPIC_PREF, CURSOR_PREF] as const;
export type AllowedModelPref = (typeof ALLOWED_MODEL_PREFS)[number];

const KNOWN: Record<string, CoachModelSelection> = {
  [ANTHROPIC_PREF]: { provider: "anthropic", model: DEFAULT_ANTHROPIC_MODEL },
  [CURSOR_PREF]: { provider: "cursor", model: CURSOR_COMPOSER_MODEL },
  // Existing users selected the standard slug before the fast variant became
  // the production default. Upgrade that stored preference in memory so a
  // deploy cannot silently fall back to Anthropic.
  [LEGACY_CURSOR_PREF]: { provider: "cursor", model: CURSOR_COMPOSER_MODEL },
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
  return ANTHROPIC_DEFAULT;
}

/** Whether the Cursor provider is available (shared key configured). */
export function cursorProviderEnabled(): boolean {
  return Boolean(process.env.CURSOR_API_KEY);
}

/**
 * Resolve the provider for a coach turn. If a user selected Cursor but the
 * shared key is unset (e.g. removed from env), fall back to Anthropic rather
 * than failing the turn.
 */
export function resolveCoachProvider(userId: number): CoachModelSelection {
  const selection = parseModelPref(getUserSettings(userId)?.model_pref);
  if (selection.provider === "cursor" && !cursorProviderEnabled()) {
    return ANTHROPIC_DEFAULT;
  }
  return selection;
}
