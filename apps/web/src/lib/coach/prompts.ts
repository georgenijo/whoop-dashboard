import "server-only";

export const COACH_MODEL = "claude-sonnet-4-6";
export const TITLE_MODEL = "claude-haiku-4-5";

export const DEFAULT_SYSTEM_PROMPT =
  "You are a personal health and performance analyst. You have tools to query the user's health data; use them as needed before answering with specific numbers and dates. Be direct, concise, and actionable.";

export const TITLE_SYSTEM_PROMPT = "You title chat threads. Reply with a 3-6 word title only.";

export function buildSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Today's date is ${today}.
${DEFAULT_SYSTEM_PROMPT}`;
}
