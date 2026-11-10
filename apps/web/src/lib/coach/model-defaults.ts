// Single source of truth (issue #587) for the Anthropic model IDs the coach
// uses by default: the chat loop's fallback model, chat thread titles, and
// daily insights. Every call site imports from here instead of hard-coding a
// generation, so adopting a newer model family is a one-file change.
//
// Environment overrides let a deployment pin or swap an ID without a code
// change. Client-safe by design (no "server-only" import); see the settings
// page's initial model preference for why env-derived values must never
// participate in that page's initial render.
import type { AnthropicModelOption } from "./anthropic-model-options";

export const FALLBACK_CHAT_MODEL = "claude-sonnet-5-5";
export const FALLBACK_TITLE_MODEL = "claude-haiku-5-5";
export const FALLBACK_INSIGHT_MODEL = "claude-haiku-5-5";

function configuredModel(envName: string, fallback: string): string {
  const value = process.env[envName]?.trim();
  return value ? value : fallback;
}

/** Default chat model for a user with no saved `model_pref`. */
export function defaultChatModel(): string {
  return configuredModel("COACH_DEFAULT_MODEL", FALLBACK_CHAT_MODEL);
}

/** Model for LLM-generated chat thread titles. */
export function titleModel(): string {
  return configuredModel("COACH_TITLE_MODEL", FALLBACK_TITLE_MODEL);
}

/** Model for the daily insight generation. */
export function insightModel(): string {
  return configuredModel("COACH_INSIGHT_MODEL", FALLBACK_INSIGHT_MODEL);
}

// Family affinity for the same-family fallback. Both Anthropic ID layouts
// normalize to the same explicit family:
//   modern:  claude-<family>-<version>[-<date>]       -> claude-<family>
//   legacy:  claude-<major>[-<minor>]-<family>[-<date>] -> claude-<family>
// so "claude-sonnet-5-5" and the legacy "claude-3-7-sonnet-20250219" both
// resolve to "claude-sonnet" (and haiku likewise). IDs that fit neither
// layout are their own family.
const LEGACY_FAMILY_RE =
  /^claude-(?:\d+-)?\d+-(haiku|opus|sonnet)(?:-[\d-]*)?$/;

function modelFamily(id: string): string {
  const legacy = id.match(LEGACY_FAMILY_RE);
  if (legacy) return `claude-${legacy[1]}`;
  return id.match(/^(.+?)-\d[\d-]*$/)?.[1] ?? id;
}

const warnedConfigurations = new Set<string>();

function warnOnce(configured: string, replacement: AnthropicModelOption | null): void {
  if (warnedConfigurations.has(configured)) return;
  warnedConfigurations.add(configured);
  console.warn(
    `[coach] configured model "${configured}" is not in the account catalog; ` +
      (replacement
        ? `falling back to "${replacement.id}" (newest of the same family).`
        : "sending it unverified."),
  );
}

/**
 * Resolve a configured generation model ID against the account catalog.
 *
 * When the configured ID is missing, fall back to the newest catalog model of
 * the same family — the Models API lists models newest first, so the first
 * family match is the newest. With no family match, send the configured ID
 * unverified. Either way a warning is logged once per configured ID per
 * process, so a silently divergent deployment is visible in the logs without
 * spamming every generation.
 */
export function resolveConfiguredModel(
  catalog: readonly AnthropicModelOption[],
  configured: string,
): { model: string; option: AnthropicModelOption | null } {
  const exact = catalog.find((entry) => entry.id === configured);
  if (exact) return { model: configured, option: exact };
  const family = modelFamily(configured);
  const replacement = catalog.find((entry) => modelFamily(entry.id) === family);
  if (replacement) {
    warnOnce(configured, replacement);
    return { model: replacement.id, option: replacement };
  }
  warnOnce(configured, null);
  return { model: configured, option: null };
}
