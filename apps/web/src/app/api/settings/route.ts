import { getSetting, setSetting } from "@/lib/db";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/coach/prompts";

export async function GET() {
  return Response.json({
    use_api_mode: getSetting("use_api_mode") === "1",
    api_key_present: !!process.env.ANTHROPIC_API_KEY,
    system_prompt: getSetting("system_prompt") || DEFAULT_SYSTEM_PROMPT,
    default_system_prompt: DEFAULT_SYSTEM_PROMPT,
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    use_api_mode?: boolean;
    system_prompt?: string;
  };
  if (typeof body.use_api_mode === "boolean") {
    setSetting("use_api_mode", body.use_api_mode ? "1" : "0");
  }
  if (typeof body.system_prompt === "string") {
    setSetting("system_prompt", body.system_prompt);
  }
  return Response.json({
    use_api_mode: getSetting("use_api_mode") === "1",
    api_key_present: !!process.env.ANTHROPIC_API_KEY,
    system_prompt: getSetting("system_prompt") || DEFAULT_SYSTEM_PROMPT,
    default_system_prompt: DEFAULT_SYSTEM_PROMPT,
  });
}
