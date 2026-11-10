import "server-only";
// Coach provider selection. The coach can run on Anthropic (default) or Cursor
// Composer. Both providers support per-user BYOK with a shared env fallback.
// Selection is stored
// in `user_settings.model_pref` as a "<provider>:<model>" string — no DB
// migration, reuses the existing column. Unknown / NULL prefs fall back to the
// Anthropic default, so legacy values and unset users keep working unchanged.
import { getUserSettings } from "@/lib/db";
import type { CursorModelParameterSelection } from "./cursor-model-params";
import { effectiveAnthropicEffort, type AnthropicModelOption } from "./anthropic-model-options";
import type { MessageCreateParamsBase } from "@anthropic-ai/sdk/resources/messages";

export type CoachProvider = "anthropic" | "cursor";
export type CoachModelSelection = {
  provider: CoachProvider;
  model: string;
  parameters?: CursorModelParameterSelection[];
};
export const COACH_EFFORTS = ["off", "low", "medium", "high", "xhigh", "max"] as const;
export type CoachEffort = (typeof COACH_EFFORTS)[number];
export type ActiveCoachEffort = Exclude<CoachEffort, "off">;

// Default chat model — must match the Anthropic loop's model constant.
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
export const CURSOR_COMPOSER_MODEL = "composer-2.5-fast";

export const ANTHROPIC_PREF = `anthropic:${DEFAULT_ANTHROPIC_MODEL}`;
export const CURSOR_PREF = `cursor:${CURSOR_COMPOSER_MODEL}`;
export const DEFAULT_COACH_EFFORT: CoachEffort = "medium";

const ANTHROPIC_DEFAULT: CoachModelSelection = {
  provider: "anthropic",
  model: DEFAULT_ANTHROPIC_MODEL,
};

/** Parse a stored model_pref into a provider+model, defaulting to Anthropic. */
export function parseModelPref(
  pref: string | null | undefined,
): CoachModelSelection {
  const provider = pref?.startsWith("cursor:") ? "cursor"
    : pref?.startsWith("anthropic:") ? "anthropic" : null;
  if (provider && pref) {
    const model = pref.slice(provider.length + 1);
    if (
      model &&
      !model.startsWith("-") &&
      model.length <= 200 &&
      !/[\s\x00-\x1f]/.test(model)
    ) {
      return { provider, model };
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

export function isCoachEffort(value: unknown): value is CoachEffort {
  return (
    typeof value === "string" &&
    (COACH_EFFORTS as readonly string[]).includes(value)
  );
}

export function parseCoachEffort(value: unknown): CoachEffort {
  return isCoachEffort(value) ? value : DEFAULT_COACH_EFFORT;
}

export function anthropicReasoningConfig(
  effort: CoachEffort,
  model: AnthropicModelOption,
  maxTokens: number,
): Pick<MessageCreateParamsBase, "thinking" | "output_config"> {
  const effective = effectiveAnthropicEffort(model, effort);
  if (model.thinking === "none") return {};
  if (effective === "off") return { thinking: { type: "disabled" } };
  if (model.thinking === "enabled") {
    const budgets = { low: 1024, medium: 4096, high: 8192, xhigh: 10240, max: 12288 };
    const budget = Math.min(budgets[effective], maxTokens - 1);
    return budget < 1024 ? { thinking: { type: "disabled" } }
      : { thinking: { type: "enabled", budget_tokens: budget } };
  }
  return {
    thinking: { type: "adaptive" },
    ...(model.output_effort ? { output_config: { effort: effective } } : {}),
  };
}

export function resolveCoachEffort(userId: number): CoachEffort {
  return parseCoachEffort(getUserSettings(userId)?.coach_effort);
}

/** Whether Cursor has either a personal key or the shared server fallback. */
export function cursorProviderEnabled(userId: number): boolean {
  return Boolean(
    getUserSettings(userId)?.cursor_key || process.env.CURSOR_API_KEY,
  );
}

export function anthropicProviderEnabled(userId: number): boolean {
  return Boolean(getUserSettings(userId)?.anthropic_key || process.env.ANTHROPIC_API_KEY);
}

/** Preserve explicit provider choices, including when a credential disappears.
 * Missing credentials must never silently route a turn to another paid provider.
 */
export function resolveCoachProvider(userId: number): CoachModelSelection {
  const settings = getUserSettings(userId);
  const selection = parseModelPref(settings?.model_pref);
  if (selection.provider === "cursor") {
    return {
      ...selection,
      parameters: settings?.cursor_model_params?.[selection.model] ?? [],
    };
  }
  return selection;
}
