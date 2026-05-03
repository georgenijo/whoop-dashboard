import "server-only";
import type { TextBlockParam } from "@anthropic-ai/sdk/resources/messages";

export const COACH_MODEL = "claude-sonnet-4-6";
export const TITLE_MODEL = "claude-haiku-4-5";

export const DEFAULT_SYSTEM_PROMPT =
  "You are a personal health and performance analyst. You have tools to query the user's health data; use them as needed before answering with specific numbers and dates. Be direct, concise, and actionable.";

export const TITLE_SYSTEM_PROMPT = "You title chat threads. Reply with a 3-6 word title only.";

const COACH_TIME_ZONE = "America/New_York";

export function buildSystemPrompt(now = new Date()): TextBlockParam[] {
  // en-CA locale formats as YYYY-MM-DD.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: COACH_TIME_ZONE }).format(now);
  return [
    { type: "text", text: `Today's date is ${today}.` },
    {
      type: "text",
      text: DEFAULT_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
  ];
}
