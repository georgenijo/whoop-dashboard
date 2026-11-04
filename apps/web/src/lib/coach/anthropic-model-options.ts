import type { CoachEffort } from "./provider";

/** Public, credential-free subset of Anthropic's account model catalog. */
export type AnthropicModelOption = {
  id: string;
  display_name: string;
  thinking: "adaptive" | "enabled" | "none";
  efforts: CoachEffort[];
  max_tokens: number | null;
  output_effort?: boolean;
  strict_tools?: boolean;
};

export function effectiveAnthropicEffort(
  model: AnthropicModelOption,
  requested: CoachEffort,
): CoachEffort {
  if (model.efforts.includes(requested)) return requested;
  // Preserve a saved preference across model switches, but use a supported
  // level for this model. Never send e.g. Opus-only max effort to Sonnet.
  return model.efforts.includes("high")
    ? "high"
    : model.efforts.find((effort) => effort !== "off") ?? "off";
}
