import "server-only";
import type { TextBlockParam } from "@anthropic-ai/sdk/resources/messages";

export const COACH_MODEL = "claude-sonnet-4-6";
export const TITLE_MODEL = "claude-haiku-4-5";

export const DEFAULT_SYSTEM_PROMPT =
  "You are a personal health and performance analyst. You have tools to query the user's health data; use them as needed before answering with specific numbers and dates. Be direct, concise, and actionable.";

export const TITLE_SYSTEM_PROMPT = "You title chat threads. Reply with a 3-6 word title only.";

export function buildSystemPrompt(): TextBlockParam[] {
  // en-CA locale formats as YYYY-MM-DD; uses server's local timezone.
  const today = new Intl.DateTimeFormat("en-CA").format(new Date());
  return [
    { type: "text", text: `Today's date is ${today}.` },
    {
      type: "text",
      text: DEFAULT_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
  ];
}
