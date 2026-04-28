import { getSetting, setSetting } from "@/lib/db";

export async function GET() {
  return Response.json({
    use_api_mode: getSetting("use_api_mode") === "1",
    api_key_present: !!process.env.ANTHROPIC_API_KEY,
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { use_api_mode?: boolean };
  if (typeof body.use_api_mode === "boolean") {
    setSetting("use_api_mode", body.use_api_mode ? "1" : "0");
  }
  return Response.json({
    use_api_mode: getSetting("use_api_mode") === "1",
    api_key_present: !!process.env.ANTHROPIC_API_KEY,
  });
}
