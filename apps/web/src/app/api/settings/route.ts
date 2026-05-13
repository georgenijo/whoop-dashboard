import { getSetting, setSetting } from "@/lib/db";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/coach/prompts";

export async function GET() {
  return Response.json({
    system_prompt: getSetting("system_prompt") || DEFAULT_SYSTEM_PROMPT,
    default_system_prompt: DEFAULT_SYSTEM_PROMPT,
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    system_prompt?: string;
  };
  if (typeof body.system_prompt === "string") {
    setSetting("system_prompt", body.system_prompt);
  }
  return Response.json({
    system_prompt: getSetting("system_prompt") || DEFAULT_SYSTEM_PROMPT,
    default_system_prompt: DEFAULT_SYSTEM_PROMPT,
  });
}
