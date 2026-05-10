import { requireAuth } from "@/lib/auth";
import { upsertDeviceToken } from "@/lib/db/devices";

export const dynamic = "force-dynamic";

// APNs hex tokens are 32 bytes (64 hex chars). Apple has hinted at longer
// tokens for future device classes, so accept ≥64 hex rather than ===.
const TOKEN_RE = /^[0-9a-fA-F]{64,200}$/;

type RegisterBody = {
  token?: unknown;
  platform?: unknown;
  env?: unknown;
  app_version?: unknown;
};

export async function POST(req: Request) {
  let user: { id: number };
  try {
    ({ user } = await requireAuth(req));
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }

  let body: RegisterBody;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!TOKEN_RE.test(token)) {
    return Response.json({ error: "invalid_token" }, { status: 400 });
  }

  if (body.platform !== "ios") {
    return Response.json({ error: "invalid_platform" }, { status: 400 });
  }

  if (body.env !== "production" && body.env !== "development") {
    return Response.json({ error: "invalid_env" }, { status: 400 });
  }

  const appVersion =
    typeof body.app_version === "string" && body.app_version.trim()
      ? body.app_version.trim().slice(0, 64)
      : null;

  try {
    upsertDeviceToken({
      user_id: user.id,
      token,
      platform: body.platform,
      env: body.env,
      app_version: appVersion,
    });
  } catch (err) {
    console.error(
      `[devices/register] upsert failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return Response.json({ error: "registration_failed" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
